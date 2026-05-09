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
