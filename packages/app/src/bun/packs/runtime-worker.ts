// Worker entry for executing a Tier 2 pack's `viz_frame` in isolation.
//
// The host owns a SharedArrayBuffer that carries inputs (timeMs, features,
// params) and outputs (uniform bytes). Coordination is via a single Int32
// status atomic at offset 0:
//   0 = idle (host may write inputs)
//   1 = requested by host (worker must consume)
//   2 = ready (worker has written outputs; host must consume)
//
// This file runs in a Worker, so its `self` is the global scope and the
// WebAssembly instance is contained within this VM. A misbehaving pack
// (infinite loop, OOM, trap) blows up the worker, not the host renderer.

const FEATURE_COUNT = 8;
const FEATURES_OFFSET = 16;
const FEATURES_BYTES = 32;

type InitMessage = {
	type: "init";
	packId: string;
	bytes: Uint8Array;
	parameterCount: number;
	maxPages: number;
	sab: SharedArrayBuffer;
};

let memoryRef: WebAssembly.Memory | null = null;
let vizFrameFn: ((h: number, t: number, f: number, p: number) => number) | null = null;
let vizDisposeFn: ((h: number) => void) | undefined;
let handle = 0;
let featuresPtr = 0;
let paramsPtr = 0;
let declaredSize = 0;
let parameterCount = 0;
let maxPages = 1024;
let packId = "";

let sabStatus: Int32Array | null = null;
let sabTime: Float32Array | null = null;
let sabOutputLen: Uint32Array | null = null;
let sabFeatures: Float32Array | null = null;
let sabParams: Float32Array | null = null;
let sabOutput: Uint8Array | null = null;

const decoder = new TextDecoder();

self.onmessage = async (e: MessageEvent) => {
	const data = e.data;
	if (!data || typeof data !== "object") return;
	if (data.type === "init") {
		try {
			await initialize(data as InitMessage);
			(self as unknown as Worker).postMessage({ type: "ready", packUniformSize: declaredSize });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			(self as unknown as Worker).postMessage({ type: "error", message });
		}
	} else if (data.type === "frame") {
		runFrame();
	} else if (data.type === "dispose") {
		try { vizDisposeFn?.(handle); } catch {}
	}
};

async function initialize(opts: InitMessage): Promise<void> {
	packId = opts.packId;
	parameterCount = opts.parameterCount;
	maxPages = opts.maxPages;

	const paramsBytes = parameterCount * 4;
	const inputEnd = FEATURES_OFFSET + FEATURES_BYTES + paramsBytes;
	const outputCapacity = opts.sab.byteLength - inputEnd;
	if (outputCapacity < 16) throw new Error("SAB too small for output region");

	sabStatus = new Int32Array(opts.sab, 0, 1);
	sabTime = new Float32Array(opts.sab, 4, 1);
	sabOutputLen = new Uint32Array(opts.sab, 8, 1);
	sabFeatures = new Float32Array(opts.sab, FEATURES_OFFSET, FEATURE_COUNT);
	sabParams = parameterCount > 0
		? new Float32Array(opts.sab, FEATURES_OFFSET + FEATURES_BYTES, parameterCount)
		: null;
	sabOutput = new Uint8Array(opts.sab, inputEnd, outputCapacity);

	// Provided in case the pack was compiled with --importMemory; AssemblyScript's
	// default builds export their own memory and silently ignore this import.
	const importedMemory = new WebAssembly.Memory({ initial: 1, maximum: maxPages });

	const importObject: WebAssembly.Imports = {
		env: {
			memory: importedMemory,
			host_log: (ptrV: number, len: number) => {
				if (!memoryRef) return;
				try {
					const view = new Uint8Array(memoryRef.buffer, ptrV, len);
					console.log(`[pack:${packId}] ${decoder.decode(view)}`);
				} catch {}
			},
			host_random: () => Math.random(),
			host_now_ms: () => performance.now(),
			abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
				console.error(
					`[pack:${packId}] abort msg=${msgPtr} file=${filePtr} ${line}:${col}`,
				);
			},
		},
	};

	const module = await WebAssembly.compile(opts.bytes);
	const instance = await WebAssembly.instantiate(module, importObject);
	const exports = instance.exports as Record<string, WebAssembly.ExportValue>;

	if (exports.memory instanceof WebAssembly.Memory) {
		// Validate exported memory doesn't exceed our configured page limit.
		// WebAssembly.Memory.buffer.byteLength / 65536 gives current pages.
		// We can't read the declared maximum from JS, but we can enforce at runtime:
		// if current allocation already exceeds our limit, reject immediately.
		const currentPages = exports.memory.buffer.byteLength / 65536;
		if (currentPages > maxPages) {
			throw new Error(
				`pack "${packId}" exports memory with ${currentPages} pages (max allowed: ${maxPages})`,
			);
		}
		memoryRef = exports.memory;
	} else {
		memoryRef = importedMemory;
	}

	for (const name of ["viz_init", "viz_frame", "viz_pack_uniform_size"]) {
		if (typeof exports[name] !== "function") {
			throw new Error(`pack "${packId}" missing required export: ${name}`);
		}
	}

	const vizInit = exports.viz_init as (a: number, b: number) => number;
	vizFrameFn = exports.viz_frame as (h: number, t: number, f: number, p: number) => number;
	vizDisposeFn = exports.viz_dispose as ((h: number) => void) | undefined;
	const vizPackUniformSize = exports.viz_pack_uniform_size as () => number;

	declaredSize = vizPackUniformSize();
	if (declaredSize > outputCapacity) {
		throw new Error(
			`pack "${packId}" declared ${declaredSize} pack-uniform bytes; SAB output holds ${outputCapacity}`,
		);
	}

	handle = vizInit(FEATURE_COUNT, parameterCount);

	const allocFn = exports.__new as ((size: number, id: number) => number) | undefined;
	const pinFn = exports.__pin as ((ptr: number) => number) | undefined;
	if (allocFn) {
		featuresPtr = allocFn(FEATURE_COUNT * 4, 0);
		paramsPtr = allocFn(Math.max(1, parameterCount) * 4, 0);
		if (pinFn) {
			pinFn(featuresPtr);
			pinFn(paramsPtr);
		}
	} else {
		featuresPtr = memoryRef.buffer.byteLength - 1024;
		paramsPtr = memoryRef.buffer.byteLength - 512;
	}
}

function runFrame(): void {
	if (
		!vizFrameFn || !memoryRef || !sabStatus || !sabTime || !sabOutputLen ||
		!sabFeatures || !sabOutput
	) return;
	if (Atomics.load(sabStatus, 0) !== 1) return;

	try {
		// Re-fetch each access — viz_frame may grow memory and detach prior views.
		{
			const buf = memoryRef.buffer;
			const featBytes = FEATURE_COUNT * 4;
			if (featuresPtr < 0 || featuresPtr + featBytes > buf.byteLength) {
				throw new Error("features region out of range");
			}
			new Float32Array(buf, featuresPtr, FEATURE_COUNT).set(sabFeatures);
			if (sabParams && parameterCount > 0) {
				const paramBytes = parameterCount * 4;
				if (paramsPtr < 0 || paramsPtr + paramBytes > buf.byteLength) {
					throw new Error("params region out of range");
				}
				new Float32Array(buf, paramsPtr, parameterCount).set(sabParams);
			}
		}

		const timeMs = sabTime[0]!;
		const outOffset = vizFrameFn(handle, timeMs, featuresPtr, paramsPtr);

		const memBuf = memoryRef.buffer;
		if (outOffset < 0 || outOffset + declaredSize > memBuf.byteLength) {
			throw new Error("viz_frame returned out-of-range uniform offset");
		}

		sabOutput.set(new Uint8Array(memBuf, outOffset, declaredSize));
		sabOutputLen[0] = declaredSize;

		if (memBuf.byteLength > maxPages * 65536) {
			throw new Error(`pack memory grew past ${maxPages} pages`);
		}

		Atomics.store(sabStatus, 0, 2);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		(self as unknown as Worker).postMessage({ type: "frameError", message });
		Atomics.store(sabStatus, 0, 0);
	}
}
