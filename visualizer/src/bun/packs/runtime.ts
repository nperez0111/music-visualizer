// Host-side runtime for Tier 2 (WASM) visualizer packs.
//
// ABI v1 (see plan: "Visualizer pack format" section)
//   Exports (all optional except viz_pack_uniform_size, viz_init, viz_frame):
//     viz_pack_uniform_size() -> u32
//     viz_init(audio_feature_count: u32, parameter_count: u32) -> u32 (handle)
//     viz_frame(handle: u32, time_ms: f32, features_ptr: u32, params_ptr: u32) -> u32 (offset)
//     viz_dispose(handle: u32)
//   Imports (host-provided; pack only declares those it uses):
//     host_log(ptr: u32, len: u32)
//     host_random() -> f32
//     host_now_ms() -> f32

export type WasmInstance = {
	exports: WebAssembly.Exports;
	memory: WebAssembly.Memory;
};

export type WasmRuntime = {
	packId: string;
	packUniformSize: number;        // bytes the pack writes per frame, <= caller's reserve
	featureCount: number;
	parameterCount: number;
	/** Run one frame; returns a Uint8Array view onto the pack's uniform output. */
	frame: (
		timeMs: number,
		audioFeatures: Float32Array,
		parameters: Float32Array,
	) => Uint8Array;
	dispose: () => void;
};

const FEATURE_COUNT = 8; // rms,peak,bass,mid,treble,bpm,beat_phase,_pad
const MAX_PACK_UNIFORM_BYTES = 16208; // 16384-byte buffer minus 176 reserved for host scalars+spectrum

/**
 * Instantiates a pack's WASM module against the host's import table and
 * runs `viz_init`. Returns a runtime handle that can be invoked once per
 * frame to compute pack-defined uniforms.
 */
export async function instantiateWasmPack(opts: {
	packId: string;
	bytes: Uint8Array;
	parameterCount: number;
}): Promise<WasmRuntime> {
	const { packId, bytes, parameterCount } = opts;

	let memoryRef: WebAssembly.Memory | null = null;
	const decoder = new TextDecoder();

	const importObject: WebAssembly.Imports = {
		env: {
			host_log: (ptrV: number, len: number) => {
				if (!memoryRef) return;
				const view = new Uint8Array(memoryRef.buffer, ptrV, len);
				console.log(`[pack:${packId}] ${decoder.decode(view)}`);
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

	const module = await WebAssembly.compile(bytes);
	const instance = await WebAssembly.instantiate(module, importObject);
	const exports = instance.exports as Record<string, WebAssembly.ExportValue>;

	// Find a memory export (AssemblyScript exports it as `memory`).
	if (exports.memory instanceof WebAssembly.Memory) {
		memoryRef = exports.memory;
	}
	if (!memoryRef) {
		throw new Error(`pack "${packId}" does not export memory`);
	}

	const requiredExports = ["viz_init", "viz_frame", "viz_pack_uniform_size"];
	for (const name of requiredExports) {
		if (typeof exports[name] !== "function") {
			throw new Error(`pack "${packId}" missing required export: ${name}`);
		}
	}

	const vizInit = exports.viz_init as (a: number, b: number) => number;
	const vizFrame = exports.viz_frame as (
		h: number,
		t: number,
		f: number,
		p: number,
	) => number;
	const vizDispose = exports.viz_dispose as ((h: number) => void) | undefined;
	const vizPackUniformSize = exports.viz_pack_uniform_size as () => number;

	const declaredSize = vizPackUniformSize();
	if (declaredSize > MAX_PACK_UNIFORM_BYTES) {
		throw new Error(
			`pack "${packId}" declared ${declaredSize} pack-uniform bytes; max is ${MAX_PACK_UNIFORM_BYTES}`,
		);
	}

	const handle = vizInit(FEATURE_COUNT, parameterCount);

	// Allocate scratch regions inside pack memory for features + parameters.
	// We use the AssemblyScript-friendly `__new` if present, otherwise fall
	// back to fixed offsets near the top of the static heap.
	const allocFn = exports.__new as ((size: number, id: number) => number) | undefined;
	const pinFn = exports.__pin as ((ptr: number) => number) | undefined;
	let featuresPtr: number;
	let paramsPtr: number;
	if (allocFn) {
		featuresPtr = allocFn(FEATURE_COUNT * 4, 0);
		paramsPtr = allocFn(Math.max(1, parameterCount) * 4, 0);
		if (pinFn) {
			pinFn(featuresPtr);
			pinFn(paramsPtr);
		}
	} else {
		// Hand-rolled WASM: assume safe reserved region at the top of memory.
		// 64KiB - 1KB and 64KiB - 512B respectively.
		featuresPtr = memoryRef.buffer.byteLength - 1024;
		paramsPtr = memoryRef.buffer.byteLength - 512;
	}

	function frame(
		timeMs: number,
		audioFeatures: Float32Array,
		parameters: Float32Array,
	): Uint8Array {
		// Memory.buffer can be detached if the pack called memory.grow; re-fetch
		// each frame and re-validate every region we touch against the current
		// buffer length.
		const buf = memoryRef!.buffer;
		const featBytes = FEATURE_COUNT * 4;
		if (featuresPtr < 0 || featuresPtr + featBytes > buf.byteLength) {
			throw new Error(`pack "${packId}" features region out of range`);
		}
		const featDst = new Float32Array(buf, featuresPtr, FEATURE_COUNT);
		featDst.set(audioFeatures.subarray(0, FEATURE_COUNT));
		if (parameters.length > 0) {
			const paramBytes = parameters.length * 4;
			if (paramsPtr < 0 || paramsPtr + paramBytes > buf.byteLength) {
				throw new Error(`pack "${packId}" params region out of range`);
			}
			const parDst = new Float32Array(buf, paramsPtr, parameters.length);
			parDst.set(parameters);
		}
		const out = vizFrame(handle, timeMs, featuresPtr, paramsPtr);
		if (out < 0 || out + declaredSize > buf.byteLength) {
			throw new Error(`pack "${packId}" returned out-of-range uniform offset`);
		}
		return new Uint8Array(buf, out, declaredSize);
	}

	function dispose() {
		try { vizDispose?.(handle); } catch {}
	}

	return {
		packId,
		packUniformSize: declaredSize,
		featureCount: FEATURE_COUNT,
		parameterCount,
		frame,
		dispose,
	};
}
