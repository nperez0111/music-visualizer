import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { instantiateWasmPack } from "./runtime";

const WASM_COLOR = resolve(import.meta.dir, "..", "..", "packs", "wasm-color", "pack.wasm");

describe("instantiateWasmPack (Worker runtime)", () => {
	test("produces non-zero pack uniforms after a few frames", async () => {
		const bytes = new Uint8Array(readFileSync(WASM_COLOR));
		const rt = await instantiateWasmPack({
			packId: "wasm-color-test",
			bytes,
			parameterCount: 0,
		});
		expect(rt.packUniformSize).toBe(16);
		expect(rt.isBroken()).toBe(false);

		const features = new Float32Array([0.5, 0.6, 0.7, 0.5, 0.4, 120, 0.3, 0]);
		const params = new Float32Array(0);

		// Pump frames with small async waits so the worker can complete.
		// We tolerate a handful of empty-output frames before bytes appear.
		let sawData = false;
		for (let i = 0; i < 30 && !sawData; i++) {
			const out = rt.frame(i * 16, features, params);
			expect(out.byteLength).toBe(16);
			if (out.some((b) => b !== 0)) sawData = true;
			await Bun.sleep(8);
		}
		rt.dispose();
		expect(sawData).toBe(true);
		expect(rt.isBroken()).toBe(true);
	}, 5000);

	test("reports broken=true after dispose", async () => {
		const bytes = new Uint8Array(readFileSync(WASM_COLOR));
		const rt = await instantiateWasmPack({
			packId: "wasm-color-test-2",
			bytes,
			parameterCount: 0,
		});
		expect(rt.isBroken()).toBe(false);
		rt.dispose();
		expect(rt.isBroken()).toBe(true);
		// Subsequent frame() calls return the empty local buffer without throwing.
		const out = rt.frame(0, new Float32Array(8), new Float32Array(0));
		expect(out.byteLength).toBe(16);
	});
});
