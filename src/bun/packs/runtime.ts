// Host-side controller for Tier 2 (WASM) visualizer packs.
//
// Each pack's WebAssembly module runs in its own Worker (`runtime-worker.ts`),
// communicating via a SharedArrayBuffer. The host posts inputs and reads
// outputs each render frame; an in-flight `viz_frame` that misses its
// deadline is terminated by `worker.terminate()` and the runtime is marked
// broken — subsequent reads return zeros and `isBroken()` reports true.
//
// API surface for callers (engine/uniform-writer.ts):
//   const r = await instantiateWasmPack({ packId, bytes, parameterCount });
//   const out = r.frame(timeMs, features, params); // Uint8Array, never throws
//   r.isBroken();   // true once the watchdog tripped
//   r.dispose();    // terminate worker
//
// The frame protocol is one-frame-lagged: `frame(N)` reads the result of
// `viz_frame` for frame N-1 (or zeros, until the worker has produced a
// first result) and posts inputs for frame N+1. This avoids blocking the
// render loop while still bounding worst-case latency.

import { PACK_LIMITS } from "./limits";

const FEATURE_COUNT = 8;
const HEADER_BYTES = 16;
const FEATURES_OFFSET = 16;
const FEATURES_BYTES = 32;

export type WasmRuntime = {
	packId: string;
	packUniformSize: number;
	featureCount: number;
	parameterCount: number;
	isBroken(): boolean;
	frame: (
		timeMs: number,
		audioFeatures: Float32Array,
		parameters: Float32Array,
	) => Uint8Array;
	dispose: () => void;
};

export async function instantiateWasmPack(opts: {
	packId: string;
	bytes: Uint8Array;
	parameterCount: number;
}): Promise<WasmRuntime> {
	const { packId, bytes, parameterCount } = opts;

	const paramsBytes = parameterCount * 4;
	const sabSize =
		HEADER_BYTES + FEATURES_BYTES + paramsBytes + PACK_LIMITS.MAX_PACK_UNIFORM_BYTES;
	const sab = new SharedArrayBuffer(sabSize);

	const sabStatus = new Int32Array(sab, 0, 1);
	const sabTime = new Float32Array(sab, 4, 1);
	const sabFeatures = new Float32Array(sab, FEATURES_OFFSET, FEATURE_COUNT);
	const sabParams = parameterCount > 0
		? new Float32Array(sab, FEATURES_OFFSET + FEATURES_BYTES, parameterCount)
		: null;
	const sabOutput = new Uint8Array(
		sab,
		FEATURES_OFFSET + FEATURES_BYTES + paramsBytes,
		PACK_LIMITS.MAX_PACK_UNIFORM_BYTES,
	);

	const worker = new Worker(
		new URL("./runtime-worker.ts", import.meta.url).href,
		{ type: "module" } as WorkerOptions,
	);

	let packUniformSize = 0;
	await new Promise<void>((resolve, reject) => {
		const onMsg = (e: MessageEvent) => {
			const d = e.data;
			if (d?.type === "ready") {
				packUniformSize = d.packUniformSize;
				worker.removeEventListener("message", onMsg);
				resolve();
			} else if (d?.type === "error") {
				worker.removeEventListener("message", onMsg);
				try { worker.terminate(); } catch {}
				reject(new Error(d.message));
			}
		};
		worker.addEventListener("message", onMsg);
		worker.postMessage({
			type: "init",
			packId,
			bytes,
			parameterCount,
			maxPages: PACK_LIMITS.MAX_WASM_MEMORY_PAGES,
			sab,
		});
	});

	let frameErrorWarnings = 0;
	worker.addEventListener("message", (e: MessageEvent) => {
		if (e.data?.type === "frameError" && frameErrorWarnings < 3) {
			frameErrorWarnings++;
			console.warn(`[pack:${packId}] frame error: ${e.data.message}`);
		}
	});

	const localOutput = new Uint8Array(packUniformSize);
	let broken = false;
	let framesPending = 0;

	function markBroken(reason: string): void {
		if (broken) return;
		broken = true;
		console.warn(`[pack:${packId}] runtime broken: ${reason}`);
		localOutput.fill(0);
		try { worker.terminate(); } catch {}
	}

	function frame(
		timeMs: number,
		audioFeatures: Float32Array,
		parameters: Float32Array,
	): Uint8Array {
		if (broken) return localOutput;

		const status = Atomics.load(sabStatus, 0);
		if (status === 2) {
			localOutput.set(sabOutput.subarray(0, packUniformSize));
			Atomics.store(sabStatus, 0, 0);
			framesPending = 0;
		} else if (status === 1) {
			framesPending++;
			if (framesPending > PACK_LIMITS.WASM_FRAME_DEADLINE_FRAMES) {
				markBroken("worker missed frame deadline");
				return localOutput;
			}
		}

		if (Atomics.load(sabStatus, 0) === 0) {
			sabTime[0] = timeMs;
			sabFeatures.set(audioFeatures.subarray(0, FEATURE_COUNT));
			if (sabParams && parameters.length > 0) {
				sabParams.set(parameters.subarray(0, parameterCount));
			}
			Atomics.store(sabStatus, 0, 1);
			worker.postMessage({ type: "frame" });
			framesPending = 1;
		}

		return localOutput;
	}

	function dispose(): void {
		if (broken) return;
		broken = true;
		try { worker.postMessage({ type: "dispose" }); } catch {}
		try { worker.terminate(); } catch {}
	}

	return {
		packId,
		packUniformSize,
		featureCount: FEATURE_COUNT,
		parameterCount,
		isBroken: () => broken,
		frame,
		dispose,
	};
}
