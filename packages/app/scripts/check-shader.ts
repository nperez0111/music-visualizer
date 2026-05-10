#!/usr/bin/env bun
// Validate a pack's WGSL shader compiles without doing a full headless render.
//
//   bun scripts/check-shader.ts <slug>            # check a built-in pack
//   bun scripts/check-shader.ts --file <path.wgsl> # check a raw WGSL file
//   bun scripts/check-shader.ts --list-packs       # list available pack slugs
//
// Exits 0 on success, 1 on shader error, 2 on usage error.
//
// This is much faster than a full render — it boots wgpu, compiles the shader
// module, builds the render pipeline, and tears down without rendering any
// frames. Typical time: ~100ms vs ~300ms+ for a full render.
//
// For pack validation this also checks that:
//  - The manifest loads without errors
//  - All extra pass shaders compile
//  - Parameter buffer bindings (@group(1)) are present if parameters are declared
//  - prev-frame bindings (@group(2)) are present if shader uses them

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const REPO_ROOT = resolve(import.meta.dir, "..");

function findBundleNativeDir(): string | null {
	const override = process.env.VIZ_BUNDLE_NATIVE_DIR;
	if (override && existsSync(override)) return override;

	for (const c of [
		resolve(REPO_ROOT, "build/dev-macos-arm64/cat-nip-dev.app/Contents/MacOS"),
		resolve(REPO_ROOT, "build/canary-macos-arm64/cat-nip.app/Contents/MacOS"),
		resolve(REPO_ROOT, "node_modules/electrobun/dist-linux-arm64"),
		resolve(REPO_ROOT, "node_modules/electrobun/dist-linux-x64"),
	]) {
		if (existsSync(c)) return c;
	}
	return null;
}

const bundleDir = findBundleNativeDir();
if (!bundleDir) {
	console.error(
		"no electrobun bundle found.\n" +
		"on macOS: run `bunx electrobun dev` once to generate the dev bundle.\n" +
		"on Linux: run `bunx electrobun build --env=canary` to download dist-linux-*.\n" +
		"or set VIZ_BUNDLE_NATIVE_DIR to a directory containing bun + native libs.",
	);
	process.exit(2);
}

const bundledBun = resolve(bundleDir, "bun");
if (process.execPath !== bundledBun) {
	const { spawnSync } = await import("child_process");
	const res = spawnSync(bundledBun, [import.meta.path, ...process.argv.slice(2)], {
		cwd: bundleDir,
		stdio: "inherit",
	});
	process.exit(res.status ?? 1);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name: string): boolean {
	const idx = argv.indexOf(name);
	if (idx === -1) return false;
	argv.splice(idx, 1);
	return true;
}

function option(name: string): string | undefined {
	const idx = argv.indexOf(name);
	if (idx === -1 || idx + 1 >= argv.length) return undefined;
	const val = argv[idx + 1]!;
	argv.splice(idx, 2);
	return val;
}

const listPacks = flag("--list-packs");
const fileOpt = option("--file");

// ---------------------------------------------------------------------------
// Imports (after re-exec, so CWD is the bundle dir)
// ---------------------------------------------------------------------------

const { loadPacksFromDir } = await import(resolve(REPO_ROOT, "src/bun/packs/loader.ts"));
const { createHeadlessRenderer } = await import(resolve(REPO_ROOT, "src/bun/gpu/renderer.ts"));
const { createPackPipeline, releasePackPipeline } = await import(resolve(REPO_ROOT, "src/bun/gpu/pipeline.ts"));
const { parameterBufferSize } = await import(resolve(REPO_ROOT, "src/bun/packs/parameters.ts"));

// ---------------------------------------------------------------------------
// List packs
// ---------------------------------------------------------------------------

const packs = loadPacksFromDir(resolve(REPO_ROOT, "src/packs"));

if (listPacks) {
	console.log("Available packs:");
	for (const p of packs as any[]) {
		const slug = p.path.split("/").pop();
		const params = p.parameters?.length ? ` (${p.parameters.length} params)` : "";
		const passes = p.extraPasses?.length ? ` [${1 + p.extraPasses.length} passes]` : "";
		console.log(`  ${slug}  — ${p.name}${params}${passes}`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------------------
// Resolve what to check
// ---------------------------------------------------------------------------

type CheckTarget = {
	label: string;
	shaderText: string;
	parameterCount: number;
	usesPrevFrame: boolean;
	extraPasses: Array<{ shaderText: string }>;
};

let target: CheckTarget;

if (fileOpt) {
	const filePath = resolve(fileOpt);
	if (!existsSync(filePath)) {
		console.error(`file not found: ${filePath}`);
		process.exit(2);
	}
	const shaderText = readFileSync(filePath, "utf-8");
	const usesPrevFrame = /@group\s*\(\s*2\s*\)/.test(shaderText);
	target = {
		label: filePath,
		shaderText,
		parameterCount: 0,
		usesPrevFrame,
		extraPasses: [],
	};
} else {
	const slug = argv.shift();
	if (!slug) {
		console.error(
			"usage: bun scripts/check-shader.ts <slug>\n" +
			"       bun scripts/check-shader.ts --file <path.wgsl>\n" +
			"       bun scripts/check-shader.ts --list-packs",
		);
		process.exit(2);
	}

	const pack: any =
		packs.find((p: any) => p.id === slug) ??
		packs.find((p: any) => p.path.endsWith(`/${slug}`)) ??
		packs.find((p: any) => p.name === slug);
	if (!pack) {
		console.error(`no pack matching "${slug}". Run with --list-packs to see available slugs.`);
		process.exit(1);
	}

	target = {
		label: `${pack.name} (${pack.path.split("/").pop()})`,
		shaderText: pack.shaderText,
		parameterCount: pack.parameters?.length ?? 0,
		usesPrevFrame: pack.usesPrevFrame ?? false,
		extraPasses: pack.extraPasses ?? [],
	};
}

// ---------------------------------------------------------------------------
// Compile check — uses wgpu error scopes to detect validation errors
// ---------------------------------------------------------------------------

import { JSCallback, FFIType, ptr } from "bun:ffi";

console.log(`[check-shader] checking: ${target.label}`);
const t0 = performance.now();

const { WGPU, asPtr } = await import(resolve(REPO_ROOT, "src/bun/gpu/electrobun-gpu.ts"));
const { makeRequestCallbackInfo } = await import(resolve(REPO_ROOT, "src/bun/gpu/wgpu-helpers.ts"));
const native = WGPU.native;

// Boot a minimal headless renderer — no surface, no texture, just device
const renderer = createHeadlessRenderer({ width: 1, height: 1 });

// Dawn error-scope constants
const WGPUErrorFilter_Validation = 0x00000001;
// PopErrorScope callback: (status: u32, errorType: u32, msg_data: ptr, msg_len: u64, ud1: ptr, ud2: ptr)
// WGPUErrorType: NoError=1, Validation=2
const WGPUErrorType_NoError = 1;

/**
 * Push a validation error scope, run `fn`, pop the scope, and return the error
 * message (or null if no error). Uses the same polling pattern as the headless
 * renderer's adapter/device request.
 */
async function withValidationScope(fn: () => void): Promise<string | null> {
	native.symbols.wgpuDevicePushErrorScope(asPtr(renderer.device), WGPUErrorFilter_Validation);

	fn();

	return new Promise<string | null>((resolve) => {
		let errorMsg: string | null = null;
		const cb = new JSCallback(
			(status: number, errorType: number, msgData: number, msgLen: number | bigint) => {
				if (errorType !== WGPUErrorType_NoError && msgData && Number(msgLen) > 0) {
					// Read the WGPUStringView data
					const buf = Buffer.from(
						new Uint8Array(
							(Bun as any).FFI.toArrayBuffer(msgData, 0, Number(msgLen)),
						),
					);
					errorMsg = buf.toString("utf-8");
				} else if (errorType !== WGPUErrorType_NoError) {
					errorMsg = `validation error (type ${errorType})`;
				}
			},
			{
				// (status: u32, errorType: u32, msg_data: ptr, msg_len: u64, ud1: ptr, ud2: ptr)
				args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
				returns: FFIType.void,
			},
		);
		const cbInfo = makeRequestCallbackInfo(Number(cb.ptr));
		native.symbols.wgpuDevicePopErrorScope(asPtr(renderer.device), asPtr(cbInfo.ptr));

		let done = false;
		const poll = () => {
			for (let i = 0; i < 500; i++) {
				native.symbols.wgpuInstanceProcessEvents(asPtr(renderer.instance));
			}
			// The callback should have fired by now
			cb.close();
			resolve(errorMsg);
		};
		// Give the event loop a tick to process
		setTimeout(poll, 1);
	});
}

let ok = true;
const errors: string[] = [];

try {
	let prevView = 0;
	let prevSampler = 0;
	if (target.usesPrevFrame) {
		const { makeTextureDescriptor, makeSamplerDescriptor, TextureFormat_BGRA8Unorm,
			TextureUsage_TextureBinding, TextureUsage_CopyDst } =
			await import(resolve(REPO_ROOT, "src/bun/gpu/wgpu-helpers.ts"));
		const prevDesc = makeTextureDescriptor(1, 1, TextureFormat_BGRA8Unorm,
			TextureUsage_TextureBinding | TextureUsage_CopyDst);
		const prevTex = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), prevDesc.ptr) as number;
		prevView = native.symbols.wgpuTextureCreateView(asPtr(prevTex), asPtr(0)) as number;
		const samplerDesc = makeSamplerDescriptor();
		prevSampler = native.symbols.wgpuDeviceCreateSampler(asPtr(renderer.device), samplerDesc.ptr) as number;
	}

	// Check main shader + pipeline within a validation error scope
	const mainError = await withValidationScope(() => {
		createPackPipeline({
			renderer,
			shaderText: target.shaderText,
			uniformBufferSize: 16384,
			paramBufferSize: target.parameterCount > 0
				? parameterBufferSize(
					Array.from({ length: target.parameterCount }, () => ({ type: "float" })) as any
				  )
				: 0,
			usesPrevFrame: target.usesPrevFrame,
			prevFrameView: prevView,
			prevFrameSampler: prevSampler,
			extraPassShaders: target.extraPasses,
			chainWidth: 1,
			chainHeight: 1,
		});
	});

	if (mainError) {
		ok = false;
		errors.push(mainError);
		console.error(`[check-shader] FAILED:`);
		// Print each line of the error message for readability
		for (const line of mainError.split("\n")) {
			if (line.trim()) console.error(`  ${line}`);
		}
	} else {
		const passCount = 1 + target.extraPasses.length;
		console.log(`[check-shader] main shader: OK`);
		if (target.extraPasses.length > 0) {
			console.log(`[check-shader] extra passes (${target.extraPasses.length}): OK`);
		}
		console.log(`[check-shader] pipeline (${passCount} pass${passCount > 1 ? "es" : ""}): OK`);
	}

	if (prevView) native.symbols.wgpuTextureViewRelease(asPtr(prevView));
	if (prevSampler) native.symbols.wgpuSamplerRelease(asPtr(prevSampler));
} catch (err: any) {
	ok = false;
	errors.push(err.message ?? String(err));
	console.error(`[check-shader] FAILED: ${err.message ?? err}`);
}

const ms = Math.round(performance.now() - t0);
console.log(`[check-shader] ${ok ? "PASS" : "FAIL"} (${ms}ms)`);
process.exit(ok ? 0 : 1);
