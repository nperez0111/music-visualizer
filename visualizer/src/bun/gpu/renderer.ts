import { WGPU, WGPUBridge, type GpuWindow } from "electrobun/bun";
import { ptr, toArrayBuffer } from "bun:ffi";
import {
	makeSurfaceConfiguration,
	PresentMode_Fifo,
	TextureFormat_BGRA8Unorm,
} from "./wgpu-helpers";

export type Renderer = {
	instance: number;
	adapter: number;
	device: number;
	queue: number;
	surface: number;
	surfaceFormat: number;
	getSize: () => { width: number; height: number };
	/** Reconfigure the surface for a new size; safe to call every frame. */
	reconfigure: (width: number, height: number) => void;
};

/**
 * Boots wgpu-native against the GpuWindow's native surface. Throws if
 * `bundleWGPU` was disabled at build time or no compatible adapter exists.
 */
export function createRenderer(window: GpuWindow): Renderer {
	const native = WGPU.native;
	if (!native.available) {
		throw new Error("wgpu-native not available — enable bundleWGPU in electrobun.config.ts");
	}

	const instance = native.symbols.wgpuCreateInstance(0) as number;
	if (!instance) throw new Error("wgpuCreateInstance returned null");

	const surface = WGPUBridge.createSurfaceForView(
		instance,
		window.wgpuView.ptr as number,
	) as number;
	if (!surface) throw new Error("createSurfaceForView returned null");

	const adapterDevice = new BigUint64Array(2);
	WGPUBridge.createAdapterDeviceMainThread(instance, surface, ptr(adapterDevice));
	const adapter = Number(adapterDevice[0]);
	const device = Number(adapterDevice[1]);
	if (!adapter || !device) throw new Error("Failed to acquire adapter/device");

	const queue = native.symbols.wgpuDeviceGetQueue(device) as number;

	// Probe surface capabilities for a preferred format (with a sane fallback).
	const capsBuffer = new ArrayBuffer(64);
	const capsView = new DataView(capsBuffer);
	native.symbols.wgpuSurfaceGetCapabilities(surface, adapter, ptr(capsBuffer));
	const formatCount = Number(capsView.getBigUint64(16, true));
	const formatPtr = Number(capsView.getBigUint64(24, true));
	let surfaceFormat = TextureFormat_BGRA8Unorm;
	if (formatCount && formatPtr) {
		const formats = new Uint32Array(toArrayBuffer(formatPtr, 0, formatCount * 4));
		if (formats.length) surfaceFormat = formats[0]!;
	}

	let lastWidth = 0;
	let lastHeight = 0;

	function reconfigure(width: number, height: number) {
		if (width === lastWidth && height === lastHeight) return;
		const cfg = makeSurfaceConfiguration(device, width, height, surfaceFormat, PresentMode_Fifo);
		WGPUBridge.surfaceConfigure(surface, cfg.ptr);
		lastWidth = width;
		lastHeight = height;
	}

	const initial = window.getSize();
	reconfigure(initial.width, initial.height);

	return {
		instance,
		adapter,
		device,
		queue,
		surface,
		surfaceFormat,
		getSize: () => window.getSize(),
		reconfigure,
	};
}
