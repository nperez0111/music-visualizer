// Tiny shim around wgpu's by-value-CallbackInfo APIs so `bun:ffi` can call
// them. Background:
//
//   `wgpuInstanceRequestAdapter` and `wgpuAdapterRequestDevice` take their
//   `WGPU*CallbackInfo` parameter *by value* — a 40-byte struct. The two
//   ABIs we run on differ in how that's passed at the C level:
//
//     - AAPCS64 (macOS / Linux ARM64): aggregates > 16 bytes are passed via
//       an implicit indirect pointer. From the FFI's perspective this looks
//       like `(ptr, ptr, ptr)`, so bun:ffi can call it directly.
//
//     - x86_64 SysV (Linux x64, including GitHub-hosted ubuntu-latest):
//       aggregates > 16 bytes are passed in *memory* — the caller writes the
//       40 bytes onto the stack at the call site. bun:ffi can't model this
//       (it has no by-value-struct argument type), so calling the function
//       directly puts garbage on the stack and Dawn errors with
//       `Invalid callback mode: 0`.
//
// This file is compiled into a tiny `.so` next to libwebgpu_dawn.so during
// the Docker build / CI step. It exposes pointer-based wrappers; the C
// compiler emits the correct by-value calling sequence for the target ABI.
//
// Compile with:
//   gcc -shared -fPIC \
//     -o "$DIST/libheadlessshim.so" scripts/headless-shim.c \
//     -L"$DIST" -lwebgpu_dawn -Wl,-rpath,'$ORIGIN'
//
// where $DIST is the directory containing `libwebgpu_dawn.so`.

#include <stdint.h>
#include <stddef.h>

// Mirrors `WGPU{RequestAdapter,RequestDevice}CallbackInfo` from
// dawn/webgpu.h. The two structs share the same shape; we only need one
// definition because the by-value call doesn't care about the field types,
// just the bytes laid out at the right offsets.
typedef struct WgpuCallbackInfo {
	void *nextInChain;
	uint32_t mode;
	uint32_t _pad;
	void (*callback)(void);
	void *userdata1;
	void *userdata2;
} WgpuCallbackInfo;

typedef struct WgpuFuture { uint64_t id; } WgpuFuture;

extern WgpuFuture wgpuInstanceRequestAdapter(void *instance, const void *options, WgpuCallbackInfo cbInfo);
extern WgpuFuture wgpuAdapterRequestDevice(void *adapter, const void *descriptor, WgpuCallbackInfo cbInfo);

// Returns the future's u64 id directly so bun:ffi doesn't have to model the
// WgpuFuture struct return either (which has the same by-value problem).
uint64_t headlessShimRequestAdapter(void *instance, const void *options, const WgpuCallbackInfo *cbInfo) {
	return wgpuInstanceRequestAdapter(instance, options, *cbInfo).id;
}

uint64_t headlessShimRequestDevice(void *adapter, const void *descriptor, const WgpuCallbackInfo *cbInfo) {
	return wgpuAdapterRequestDevice(adapter, descriptor, *cbInfo).id;
}

// ---------------------------------------------------------------------------
// Buffer readback shim — replaces libNativeWrapper.so for headless rendering
// ---------------------------------------------------------------------------
//
// Wraps wgpu's async buffer map API into a simple Begin/Status/Free polling
// pattern that bun:ffi can drive. This lets the headless renderer do GPU
// readback without linking the full libNativeWrapper.so (and its GTK/WebKit
// dependency chain).
//
// Usage from TypeScript:
//   1. job = wgpuBufferReadbackBeginShim(buffer, offset, size, dstPtr)
//   2. poll: wgpuBufferReadbackStatusShim(job) → 0=pending, 1=done, -1=error
//      (call wgpuInstanceProcessEvents between polls)
//   3. wgpuBufferReadbackFreeShim(job) — cleans up

#include <stdlib.h>
#include <string.h>

// wgpu C API
typedef enum WGPUMapAsyncStatus {
	WGPUMapAsyncStatus_Success = 1,
	WGPUMapAsyncStatus_Error = 2,
	WGPUMapAsyncStatus_Aborted = 3,
	WGPUMapAsyncStatus_Unknown = 4,
} WGPUMapAsyncStatus;

typedef enum WGPUBufferMapState {
	WGPUBufferMapState_Unmapped = 1,
	WGPUBufferMapState_Pending = 2,
	WGPUBufferMapState_Mapped = 3,
} WGPUBufferMapState;

typedef enum WGPUCallbackMode {
	WGPUCallbackMode_WaitAnyOnly = 1,
	WGPUCallbackMode_AllowProcessEvents = 2,
	WGPUCallbackMode_AllowSpontaneous = 3,
} WGPUCallbackMode;

// Callback info struct for buffer map async
typedef struct WGPUBufferMapCallbackInfo {
	void *nextInChain;
	uint32_t mode;
	uint32_t _pad;
	void (*callback)(WGPUMapAsyncStatus status, void *message_data,
	                 size_t message_length, void *userdata1, void *userdata2);
	void *userdata1;
	void *userdata2;
} WGPUBufferMapCallbackInfo;

extern WgpuFuture wgpuBufferMapAsync(void *buffer, uint32_t mode,
                                     size_t offset, size_t size,
                                     WGPUBufferMapCallbackInfo callbackInfo);
extern WGPUBufferMapState wgpuBufferGetMapState(void *buffer);
extern const void *wgpuBufferGetConstMappedRange(void *buffer,
                                                  size_t offset,
                                                  size_t size);
extern void wgpuBufferUnmap(void *buffer);

#define MAP_READ 1

typedef struct ReadbackJob {
	void    *buffer;
	size_t   offset;
	size_t   size;
	void    *dst;
	int      status;  // 0=pending, 1=done, -1=error
} ReadbackJob;

static void readbackCallback(WGPUMapAsyncStatus status,
                              void *message_data,
                              size_t message_length,
                              void *userdata1,
                              void *userdata2) {
	(void)message_data;
	(void)message_length;
	(void)userdata2;
	ReadbackJob *job = (ReadbackJob *)userdata1;
	if (status == WGPUMapAsyncStatus_Success) {
		// Copy the mapped data to the destination buffer
		const void *src = wgpuBufferGetConstMappedRange(job->buffer, job->offset, job->size);
		if (src) {
			memcpy(job->dst, src, job->size);
			job->status = 1;
		} else {
			job->status = -1;
		}
		wgpuBufferUnmap(job->buffer);
	} else {
		job->status = -1;
	}
}

void *wgpuBufferReadbackBeginShim(void *buffer, uint64_t offset,
                                   uint64_t size, void *dst) {
	ReadbackJob *job = (ReadbackJob *)calloc(1, sizeof(ReadbackJob));
	if (!job) return NULL;
	job->buffer = buffer;
	job->offset = (size_t)offset;
	job->size   = (size_t)size;
	job->dst    = dst;
	job->status = 0;

	WGPUBufferMapCallbackInfo cbInfo = {0};
	cbInfo.mode = WGPUCallbackMode_AllowProcessEvents;
	cbInfo.callback = readbackCallback;
	cbInfo.userdata1 = job;

	wgpuBufferMapAsync(buffer, MAP_READ, (size_t)offset, (size_t)size, cbInfo);
	return job;
}

int wgpuBufferReadbackStatusShim(void *jobPtr) {
	ReadbackJob *job = (ReadbackJob *)jobPtr;
	return job->status;
}

void wgpuBufferReadbackFreeShim(void *jobPtr) {
	free(jobPtr);
}
