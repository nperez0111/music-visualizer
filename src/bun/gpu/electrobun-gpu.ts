/**
 * Local re-exports for the GPU symbols we need from Electrobun, bypassing the
 * `electrobun/bun` barrel export.  The barrel eagerly loads Socket.ts which
 * starts an RPC server on port 50000 — harmless when running the full app but
 * noisy (and adds a 5 s shutdown delay) in headless scripts.
 *
 * - WGPU comes from electrobun's webGPU.ts which only dlopens libwgpu_dawn and
 *   has zero side effects.
 * - WGPUBridge wraps a handful of wgpu shim symbols from libNativeWrapper.
 *   Instead of importing proc/native.ts (which transitively pulls in
 *   BrowserView → Socket), we dlopen libNativeWrapper ourselves with only
 *   the symbols we actually use.
 */

// @ts-ignore — relative path into node_modules; not a declared electrobun export
import _WGPU from "../../../node_modules/electrobun/dist/api/bun/webGPU";
export const WGPU = _WGPU;

// ---------------------------------------------------------------------------
// WGPUBridge — minimal dlopen of libNativeWrapper for wgpu shim symbols only
// ---------------------------------------------------------------------------

import { dlopen, FFIType, suffix, type Pointer } from "bun:ffi";
import { join } from "path";

/**
 * Cast a plain `number` (GPU handle) to the branded `Pointer` type that
 * bun:ffi expects. At runtime Pointer *is* just a number, but bun-types
 * brands it as `number & { __pointer__: null }` so direct assignment is a
 * type error. This utility lets all GPU call-sites stay type-safe without
 * scattering `as any` everywhere.
 */
export const asPtr = (n: number): Pointer => n as unknown as Pointer;

const nativeShim = (() => {
	try {
		const libPath = join(process.cwd(), `libNativeWrapper.${suffix}`);
		return dlopen(libPath, {
			// Surface / windowed rendering
			wgpuInstanceCreateSurfaceMainThread: {
				args: [FFIType.ptr, FFIType.ptr],
				returns: FFIType.ptr,
			},
			wgpuSurfaceConfigureMainThread: {
				args: [FFIType.ptr, FFIType.ptr],
				returns: FFIType.void,
			},
			wgpuSurfaceGetCurrentTextureMainThread: {
				args: [FFIType.ptr, FFIType.ptr],
				returns: FFIType.void,
			},
			wgpuSurfacePresentMainThread: {
				args: [FFIType.ptr],
				returns: FFIType.i32,
			},
			// Adapter / device creation (windowed path)
			wgpuCreateAdapterDeviceMainThread: {
				args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
				returns: FFIType.void,
			},
			wgpuCreateSurfaceForView: {
				args: [FFIType.ptr, FFIType.ptr],
				returns: FFIType.ptr,
			},
			// Buffer readback (headless + windowed)
			wgpuBufferReadbackBeginShim: {
				args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.ptr],
				returns: FFIType.ptr,
			},
			wgpuBufferReadbackStatusShim: {
				args: [FFIType.ptr],
				returns: FFIType.i32,
			},
			wgpuBufferReadbackFreeShim: {
				args: [FFIType.ptr],
				returns: FFIType.void,
			},
		});
	} catch {
		return null;
	}
})();

export const WGPUBridge = {
	available: !!nativeShim?.symbols?.wgpuInstanceCreateSurfaceMainThread,

	instanceCreateSurface: (instancePtr: number, descriptorPtr: number): number =>
		nativeShim!.symbols.wgpuInstanceCreateSurfaceMainThread(
			asPtr(instancePtr),
			asPtr(descriptorPtr),
		) as number,

	surfaceConfigure: (surfacePtr: number, configPtr: number) =>
		nativeShim!.symbols.wgpuSurfaceConfigureMainThread(
			asPtr(surfacePtr),
			asPtr(configPtr),
		),

	surfaceGetCurrentTexture: (surfacePtr: number, surfaceTexturePtr: number) =>
		nativeShim!.symbols.wgpuSurfaceGetCurrentTextureMainThread(
			asPtr(surfacePtr),
			asPtr(surfaceTexturePtr),
		),

	surfacePresent: (surfacePtr: number): number =>
		nativeShim!.symbols.wgpuSurfacePresentMainThread(asPtr(surfacePtr)),

	createAdapterDeviceMainThread: (
		instancePtr: number,
		surfacePtr: number,
		outAdapterDevicePtr: Pointer,
	) =>
		nativeShim!.symbols.wgpuCreateAdapterDeviceMainThread(
			asPtr(instancePtr),
			asPtr(surfacePtr),
			outAdapterDevicePtr,
		),

	createSurfaceForView: (instancePtr: number, viewPtr: number): number => {
		if (!nativeShim?.symbols?.wgpuCreateSurfaceForView) return 0;
		return nativeShim.symbols.wgpuCreateSurfaceForView(
			asPtr(instancePtr),
			asPtr(viewPtr),
		) as number;
	},

	bufferReadbackBegin: (
		bufferPtr: number,
		offset: bigint,
		size: bigint,
		dstPtr: Pointer,
	): number =>
		nativeShim!.symbols.wgpuBufferReadbackBeginShim(
			asPtr(bufferPtr),
			offset as any,
			size as any,
			dstPtr,
		) as number,

	bufferReadbackStatus: (jobPtr: number): number =>
		nativeShim!.symbols.wgpuBufferReadbackStatusShim(asPtr(jobPtr)),

	bufferReadbackFree: (jobPtr: number) =>
		nativeShim!.symbols.wgpuBufferReadbackFreeShim(asPtr(jobPtr)),
};
