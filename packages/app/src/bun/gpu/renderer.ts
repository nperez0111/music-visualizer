import { WGPU, WGPUBridge, asPtr } from "./electrobun-gpu";
import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer } from "bun:ffi";
import { existsSync } from "fs";
import { join } from "path";
import {
	makeRequestCallbackInfo,
	makeSurfaceConfiguration,
	PresentMode_Mailbox,
	TextureFormat_BGRA8Unorm,
} from "./wgpu-helpers";

// Lazy-loaded: `electrobun/bun` barrel eagerly starts an RPC server on port
// 50000, which hangs in headless/Docker environments.  Screen is only needed
// in the windowed `createRenderer()` path; headless callers never use it.
let _Screen: typeof import("electrobun/bun").Screen | undefined;

export type Renderer = {
	instance: number;
	adapter: number;
	device: number;
	queue: number;
	/** Zero in headless mode — readers must guard before calling surface APIs. */
	surface: number;
	surfaceFormat: number;
	/** Full physical/retina size for the surface (always full resolution). */
	getSize: () => { width: number; height: number };
	/**
	 * Scaled render size for intermediate targets (pack shaders). When
	 * renderScale < 1, this is smaller than getSize() — the composite pass
	 * bilinear-upscales from this to the full surface.
	 */
	getRenderSize: () => { width: number; height: number };
	/** Reconfigure the surface for a new size; safe to call every frame. No-op in headless mode. */
	reconfigure: (width: number, height: number) => void;
	/**
	 * Set the render scale factor (0..1]. 1.0 = full retina resolution,
	 * 0.5 = half resolution (quarter pixel count), etc.  Lower values
	 * dramatically improve performance for heavy fragment shaders at the
	 * cost of sharpness.  No-op in headless mode.
	 */
	setRenderScale: (scale: number) => void;
	/** Current render scale factor (1.0 = full retina). */
	getRenderScale: () => number;
};

/**
 * Anything that exposes a native WGPU view pointer and a frame size. This
 * covers both the legacy `GpuWindow.wgpuView` and the `WGPUView` obtained
 * from an embedded `<electrobun-wgpu>` tag.
 */
export type SurfaceSource = {
	ptr: number;
	frame: { width: number; height: number };
};

/**
 * Boots wgpu-native against a native WGPU view surface. Accepts any object
 * that provides a native view pointer (`.ptr`) and a frame size — works with
 * both a `GpuWindow.wgpuView` and a standalone `WGPUView` from an embedded
 * `<electrobun-wgpu>` tag.
 */
export async function createRenderer(view: SurfaceSource): Promise<Renderer> {
	const native = WGPU.native;
	if (!native.available) {
		throw new Error("wgpu-native not available — enable bundleWGPU in electrobun.config.ts");
	}

	const instance = native.symbols.wgpuCreateInstance(asPtr(0)) as number;
	if (!instance) throw new Error("wgpuCreateInstance returned null");

	const surface = WGPUBridge.createSurfaceForView(
		instance,
		view.ptr,
	);
	if (!surface) throw new Error("createSurfaceForView returned null");

	const adapterDevice = new BigUint64Array(2);
	WGPUBridge.createAdapterDeviceMainThread(instance, surface, ptr(adapterDevice));
	const adapter = Number(adapterDevice[0]);
	const device = Number(adapterDevice[1]);
	if (!adapter || !device) throw new Error("Failed to acquire adapter/device");

	const queue = native.symbols.wgpuDeviceGetQueue(asPtr(device)) as number;

	// Probe surface capabilities for a preferred format (with a sane fallback).
	const capsBuffer = new ArrayBuffer(64);
	const capsView = new DataView(capsBuffer);
	native.symbols.wgpuSurfaceGetCapabilities(asPtr(surface), asPtr(adapter), ptr(capsBuffer));
	const formatCount = Number(capsView.getBigUint64(16, true));
	const formatPtr = Number(capsView.getBigUint64(24, true));
	let surfaceFormat = TextureFormat_BGRA8Unorm;
	if (formatCount && formatPtr) {
		const formats = new Uint32Array(toArrayBuffer(asPtr(formatPtr), 0, formatCount * 4));
		if (formats.length) surfaceFormat = formats[0]!;
	}

	let lastWidth = 0;
	let lastHeight = 0;

	function reconfigure(width: number, height: number) {
		if (width === lastWidth && height === lastHeight) return;
		const cfg = makeSurfaceConfiguration(device, width, height, surfaceFormat, PresentMode_Mailbox);
		WGPUBridge.surfaceConfigure(surface, cfg.ptr);
		lastWidth = width;
		lastHeight = height;
	}

	// The WGPUView frame is in CSS/point pixels (from getBoundingClientRect).
	// The GPU surface must be configured at physical/backing pixels, so we
	// scale by the display's scale factor (2x on Retina Macs).
	if (!_Screen) {
		// Lazy import to avoid top-level side effects from electrobun barrel
		// (starts RPC server on port 50000, hangs in headless/Docker contexts).
		// Dynamic import() is required because the module contains top-level await,
		// which prevents synchronous require().
		_Screen = (await import("electrobun/bun")).Screen;
	}
	const scaleFactor = _Screen.getPrimaryDisplay().scaleFactor || 1;

	// Render scale: 1.0 = full retina, 0.5 = half res (quarter pixels), etc.
	// The surface is always configured at full retina resolution so it fills
	// the window. The render scale only affects intermediate render targets
	// (where the expensive pack shaders run). The composite pass upscales the
	// reduced-resolution targets to the full surface via bilinear sampling.
	let renderScale = 1.0;

	// Cached size objects — reused across frames to avoid per-frame allocation.
	// Updated lazily when the underlying frame dimensions or scale change.
	const cachedPhysical = { width: 0, height: 0 };
	const cachedRender = { width: 0, height: 0 };
	let sizeGeneration = 0;
	let renderSizeGen = -1;
	let renderScaleAtGen = -1;

	function physicalSize(): { width: number; height: number } {
		const w = Math.round(view.frame.width * scaleFactor);
		const h = Math.round(view.frame.height * scaleFactor);
		if (w !== cachedPhysical.width || h !== cachedPhysical.height) {
			cachedPhysical.width = w;
			cachedPhysical.height = h;
			sizeGeneration++;
		}
		return cachedPhysical;
	}

	function setRenderScale(scale: number): void {
		const clamped = Math.max(0.1, Math.min(1.0, scale));
		if (clamped === renderScale) return;
		renderScale = clamped;
	}

	function renderSize(): { width: number; height: number } {
		const full = physicalSize();
		if (renderScale >= 1.0) return full;
		if (renderSizeGen !== sizeGeneration || renderScaleAtGen !== renderScale) {
			renderSizeGen = sizeGeneration;
			renderScaleAtGen = renderScale;
			cachedRender.width = Math.max(1, Math.round(full.width * renderScale));
			cachedRender.height = Math.max(1, Math.round(full.height * renderScale));
		}
		return cachedRender;
	}

	const initial = physicalSize();
	reconfigure(initial.width, initial.height);

	return {
		instance,
		adapter,
		device,
		queue,
		surface,
		surfaceFormat,
		getSize: physicalSize,
		getRenderSize: renderSize,
		reconfigure,
		setRenderScale,
		getRenderScale: () => renderScale,
	};
}

/**
 * Boots wgpu-native without any window or surface, using the canonical async
 * `wgpuInstanceRequestAdapter` + `wgpuAdapterRequestDevice` APIs driven by
 * `wgpuInstanceProcessEvents` polling. We deliberately *don't* use electrobun's
 * `WGPUBridge.createAdapterDeviceMainThread` shim — on Linux that shim posts to
 * a GTK main loop we don't run, hanging forever (verified in a headless
 * container). The shim works on macOS only because Bun's main thread happens to
 * service the right runloop.
 *
 * The callback signatures are tricky: WGPU's *Callback functions take a
 * `WGPUStringView` struct *by value*, which bun:ffi doesn't model. On the
 * platform ABIs we care about (ARM64 AAPCS, x86_64 SysV) a 16-byte struct of
 * two pointer-sized fields is passed in two registers, so flattening to
 * `(ptr, u64)` in the JSCallback signature matches the ABI and works.
 */
export function createHeadlessRenderer(opts: { width: number; height: number }): Renderer {
	const native = WGPU.native;
	if (!native.available) {
		throw new Error("wgpu-native not available — enable bundleWGPU in electrobun.config.ts");
	}

	const instance = native.symbols.wgpuCreateInstance(asPtr(0)) as number;
	if (!instance) throw new Error("wgpuCreateInstance returned null");

	const adapter = requestAdapterSync(instance);
	if (!adapter) throw new Error("wgpuInstanceRequestAdapter returned no adapter");

	const device = requestDeviceSync(instance, adapter);
	if (!device) throw new Error("wgpuAdapterRequestDevice returned no device");

	const queue = native.symbols.wgpuDeviceGetQueue(asPtr(device)) as number;

	const size = { width: Math.max(1, opts.width), height: Math.max(1, opts.height) };
	return {
		instance,
		adapter,
		device,
		queue,
		surface: 0,
		surfaceFormat: TextureFormat_BGRA8Unorm,
		getSize: () => size,
		getRenderSize: () => size,
		reconfigure: () => {},
		setRenderScale: () => {},
		getRenderScale: () => 1.0,
	};
}

const ASYNC_POLL_MAX_ITERATIONS = 5_000;

/**
 * On x86_64 Linux, `wgpuInstanceRequestAdapter` / `wgpuAdapterRequestDevice`
 * pass their 40-byte `WGPUCallbackInfo` argument by value — which under SysV
 * means the caller writes the bytes onto the stack at the call site. bun:ffi
 * has no way to express that, so we route those two calls through a tiny
 * `libheadlessshim.so` we compile in the Docker build / CI step. The shim
 * takes the callback info by pointer; the C compiler emits the right
 * by-value sequence for whichever ABI it was built for.
 *
 * On macOS / Linux ARM64 we don't need the shim — AAPCS64 passes large
 * aggregates via an implicit indirect pointer, which bun:ffi *can* express
 * as a regular `ptr` arg. If the shim isn't present, fall back to the
 * direct call.
 */
type RequestShim = {
	requestAdapter(instance: number, cbInfoPtr: number): bigint;
	requestDevice(adapter: number, cbInfoPtr: number): bigint;
};

let cachedShim: RequestShim | null | undefined = undefined;

function loadRequestShim(): RequestShim | null {
	if (cachedShim !== undefined) return cachedShim;
	const candidates: string[] = [];
	const env = process.env.VIZ_HEADLESS_SHIM;
	if (env) candidates.push(env);
	const bundleDir = process.env.VIZ_BUNDLE_NATIVE_DIR;
	if (bundleDir) candidates.push(join(bundleDir, "libheadlessshim.so"));
	for (const path of candidates) {
		if (!existsSync(path)) continue;
		try {
			const lib = dlopen(path, {
				headlessShimRequestAdapter: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
				headlessShimRequestDevice: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
			});
			cachedShim = {
				requestAdapter: (instance, cbInfoPtr) =>
					lib.symbols.headlessShimRequestAdapter(instance as any, 0 as any, cbInfoPtr as any),
				requestDevice: (adapter, cbInfoPtr) =>
					lib.symbols.headlessShimRequestDevice(adapter as any, 0 as any, cbInfoPtr as any),
			};
			return cachedShim;
		} catch (err) {
			console.warn(`[headless] failed to load ${path}:`, (err as Error).message);
		}
	}
	cachedShim = null;
	return null;
}

function requestAdapterSync(instance: number): number {
	const native = WGPU.native;
	const shim = loadRequestShim();
	let result = 0;
	let done = false;
	const cb = new JSCallback(
		(_status: number, adapterPtr: number) => {
			result = adapterPtr;
			done = true;
		},
		// (status: u32, adapter: ptr, message_data: ptr, message_length: u64, ud1: ptr, ud2: ptr)
		// — WGPUStringView is two pointer-sized fields passed in two registers.
		{
			args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
	);
	try {
		const cbInfo = makeRequestCallbackInfo(Number(cb.ptr));
		if (shim) shim.requestAdapter(instance, cbInfo.ptr);
		else native.symbols.wgpuInstanceRequestAdapter(asPtr(instance), asPtr(0), asPtr(cbInfo.ptr));
		for (let i = 0; i < ASYNC_POLL_MAX_ITERATIONS && !done; i++) {
			native.symbols.wgpuInstanceProcessEvents(asPtr(instance));
		}
		if (!done) throw new Error("wgpuInstanceRequestAdapter did not complete after polling");
	} finally {
		cb.close();
	}
	return result;
}

function requestDeviceSync(instance: number, adapter: number): number {
	const native = WGPU.native;
	const shim = loadRequestShim();
	let result = 0;
	let done = false;
	const cb = new JSCallback(
		(_status: number, devicePtr: number) => {
			result = devicePtr;
			done = true;
		},
		{
			args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
	);
	try {
		const cbInfo = makeRequestCallbackInfo(Number(cb.ptr));
		if (shim) shim.requestDevice(adapter, cbInfo.ptr);
		else native.symbols.wgpuAdapterRequestDevice(asPtr(adapter), asPtr(0), asPtr(cbInfo.ptr));
		for (let i = 0; i < ASYNC_POLL_MAX_ITERATIONS && !done; i++) {
			native.symbols.wgpuInstanceProcessEvents(asPtr(instance));
		}
		if (!done) throw new Error("wgpuAdapterRequestDevice did not complete after polling");
	} finally {
		cb.close();
	}
	return result;
}
