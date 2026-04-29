// Thin wrappers around wgpu-native's C ABI: build the binary descriptor
// structs that the FFI symbols expect. Each builder returns { buffer, ptr };
// callers must keep `buffer` alive (push to a keepalive list) for as long
// as wgpu-native may read through the pointer — this is generally only
// during the synchronous create*/queue* call that consumes the descriptor.

import { ptr } from "bun:ffi";

// ---------- Constants ----------

// Texture formats (subset; values match wgpu-native's webgpu.h enum)
export const TextureFormat_BGRA8Unorm = 0x00000017;
export const TextureFormat_R32Float = 0x00000031;

// Texture usage bitmask
export const TextureUsage_CopySrc = 0x0000000000000001n;
export const TextureUsage_CopyDst = 0x0000000000000002n;
export const TextureUsage_TextureBinding = 0x0000000000000004n;
export const TextureUsage_StorageBinding = 0x0000000000000008n;
export const TextureUsage_RenderAttachment = 0x0000000000000010n;

// Buffer usage bitmask
export const BufferUsage_MapRead = 0x0000000000000001n;
export const BufferUsage_MapWrite = 0x0000000000000002n;
export const BufferUsage_CopySrc = 0x0000000000000004n;
export const BufferUsage_CopyDst = 0x0000000000000008n;
export const BufferUsage_Index = 0x0000000000000010n;
export const BufferUsage_Vertex = 0x0000000000000020n;
export const BufferUsage_Uniform = 0x0000000000000040n;
export const BufferUsage_Storage = 0x0000000000000080n;

// Vertex formats
export const VertexFormat_Float32 = 0x0000001c;
export const VertexFormat_Float32x2 = 0x0000001d;
export const VertexFormat_Float32x3 = 0x0000001e;
export const VertexFormat_Float32x4 = 0x0000001f;

// Vertex step modes
export const VertexStepMode_Vertex = 0x00000001;

// Primitive topology
export const PrimitiveTopology_PointList = 0x00000001;
export const PrimitiveTopology_LineList = 0x00000002;
export const PrimitiveTopology_LineStrip = 0x00000003;
export const PrimitiveTopology_TriangleList = 0x00000004;
export const PrimitiveTopology_TriangleStrip = 0x00000005;

export const FrontFace_CCW = 0x00000001;
export const CullMode_None = 0x00000001;
export const CullMode_Front = 0x00000002;
export const CullMode_Back = 0x00000003;

// Present modes
export const PresentMode_Fifo = 0x00000001;
export const PresentMode_FifoRelaxed = 0x00000002;
export const PresentMode_Immediate = 0x00000003;
export const PresentMode_Mailbox = 0x00000004;

// Load/store ops
export const LoadOp_Clear = 0x00000002;
export const LoadOp_Load = 0x00000001;
export const StoreOp_Store = 0x00000001;
export const StoreOp_Discard = 0x00000002;

// Texture aspect / dimension / sampler params
export const TextureAspect_All = 0x00000001;
export const TextureDimension_2D = 0x00000002;
export const AddressMode_ClampToEdge = 0x00000001;
export const AddressMode_Repeat = 0x00000002;
export const AddressMode_MirrorRepeat = 0x00000003;
export const FilterMode_Nearest = 0x00000001;
export const FilterMode_Linear = 0x00000002;
export const MipmapFilterMode_Nearest = 0x00000001;
export const MipmapFilterMode_Linear = 0x00000002;

// Blend state
export const BlendOperation_Add = 0x00000001;
export const BlendFactor_Zero = 0x00000001;
export const BlendFactor_One = 0x00000002;
export const BlendFactor_SrcAlpha = 0x00000005;
export const BlendFactor_OneMinusSrcAlpha = 0x00000006;

// Bind group entry: buffer types (sampling/storage variants)
export const BufferBindingType_Uniform = 0x00000001;
export const BufferBindingType_Storage = 0x00000002;
export const BufferBindingType_ReadOnlyStorage = 0x00000003;

// Shader stage bitmask
export const ShaderStage_Vertex = 0x00000001;
export const ShaderStage_Fragment = 0x00000002;
export const ShaderStage_Compute = 0x00000004;

// Misc
/** wgpu-native's "string is null-terminated, length unknown" sentinel. */
export const WGPU_STRLEN = 0xffffffffffffffffn;
export const DEPTH_SLICE_UNDEFINED = 0xffffffff;

// ---------- Low-level writers ----------

export function writePtr(view: DataView, offset: number, value: number | bigint | null) {
	view.setBigUint64(offset, BigInt(value ?? 0), true);
}

export function writeU32(view: DataView, offset: number, value: number | bigint) {
	view.setUint32(offset, Number(value) >>> 0, true);
}

export function writeU64(view: DataView, offset: number, value: bigint) {
	view.setBigUint64(offset, value, true);
}

export function writeF64(view: DataView, offset: number, value: number) {
	view.setFloat64(offset, value, true);
}

export type Descriptor = { buffer: ArrayBuffer; ptr: number };

function descriptor(size: number): Descriptor & { view: DataView } {
	const buffer = new ArrayBuffer(size);
	return { buffer, view: new DataView(buffer), ptr: ptr(buffer) as number };
}

// ---------- Surface ----------

export function makeSurfaceConfiguration(
	devicePtr: number,
	width: number,
	height: number,
	format: number,
	presentMode: number = PresentMode_Fifo,
): Descriptor {
	const d = descriptor(64);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, devicePtr);
	writeU32(d.view, 16, format);
	writeU32(d.view, 20, 0);
	writeU64(d.view, 24, TextureUsage_RenderAttachment);
	writeU32(d.view, 32, width);
	writeU32(d.view, 36, height);
	writeU64(d.view, 40, 0n);
	writePtr(d.view, 48, 0);
	writeU32(d.view, 56, 1);
	writeU32(d.view, 60, presentMode);
	return d;
}

export function makeSurfaceTexture(): Descriptor & { view: DataView } {
	return descriptor(24);
}

// ---------- Shader ----------

export function makeShaderSourceWGSL(codePtr: number): Descriptor {
	const d = descriptor(32);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, 0x00000002); // SType_ShaderSourceWGSL
	writeU32(d.view, 12, 0);
	writePtr(d.view, 16, codePtr);
	writeU64(d.view, 24, WGPU_STRLEN);
	return d;
}

export function makeShaderModuleDescriptor(nextInChainPtr: number): Descriptor {
	const d = descriptor(24);
	writePtr(d.view, 0, nextInChainPtr);
	writePtr(d.view, 8, 0);
	writeU64(d.view, 16, 0n);
	return d;
}

// ---------- Pipeline: vertex / fragment / state ----------

export function makeVertexAttribute(
	offset: number,
	shaderLocation: number,
	format: number,
): Descriptor {
	const d = descriptor(32);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, format);
	writeU32(d.view, 12, 0);
	writeU64(d.view, 16, BigInt(offset));
	writeU32(d.view, 24, shaderLocation);
	writeU32(d.view, 28, 0);
	return d;
}

export function makeVertexBufferLayout(
	stride: number,
	attributePtr: number,
	attributeCount: number,
): Descriptor {
	const d = descriptor(40);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, VertexStepMode_Vertex);
	writeU32(d.view, 12, 0);
	writeU64(d.view, 16, BigInt(stride));
	writeU64(d.view, 24, BigInt(attributeCount));
	writePtr(d.view, 32, attributePtr);
	return d;
}

/** Pass `bufferCount = 0, bufferLayoutPtr = 0` for fullscreen-triangle / no-VBO pipelines. */
export function makeVertexState(
	modulePtr: number,
	entryPointPtr: number,
	bufferCount: number,
	bufferLayoutPtr: number,
): Descriptor {
	const d = descriptor(64);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, modulePtr);
	writePtr(d.view, 16, entryPointPtr);
	writeU64(d.view, 24, WGPU_STRLEN);
	writeU64(d.view, 32, 0n);
	writePtr(d.view, 40, 0);
	writeU64(d.view, 48, BigInt(bufferCount));
	writePtr(d.view, 56, bufferLayoutPtr);
	return d;
}

export function makeFragmentState(
	modulePtr: number,
	entryPointPtr: number,
	targetPtr: number,
	targetCount: number = 1,
): Descriptor {
	const d = descriptor(64);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, modulePtr);
	writePtr(d.view, 16, entryPointPtr);
	writeU64(d.view, 24, WGPU_STRLEN);
	writeU64(d.view, 32, 0n);
	writePtr(d.view, 40, 0);
	writeU64(d.view, 48, BigInt(targetCount));
	writePtr(d.view, 56, targetPtr);
	return d;
}

export function makeColorTargetState(
	format: number,
	writeMask: bigint = 0x0fn,
	blendPtr: number = 0,
): Descriptor {
	const d = descriptor(32);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, format);
	writeU32(d.view, 12, 0);
	writePtr(d.view, 16, blendPtr); // blend state (0 = none)
	writeU64(d.view, 24, writeMask);
	return d;
}

/**
 * Standard non-premultiplied alpha blend (src.a*src + (1-src.a)*dst). The
 * 24-byte struct holds two BlendComponents (color, alpha), each 12 bytes:
 * { operation: u32, srcFactor: u32, dstFactor: u32 }.
 */
export function makeBlendStateAlpha(): Descriptor {
	const d = descriptor(24);
	// color: SrcAlpha, OneMinusSrcAlpha, Add
	writeU32(d.view, 0, BlendOperation_Add);
	writeU32(d.view, 4, BlendFactor_SrcAlpha);
	writeU32(d.view, 8, BlendFactor_OneMinusSrcAlpha);
	// alpha: One, OneMinusSrcAlpha, Add
	writeU32(d.view, 12, BlendOperation_Add);
	writeU32(d.view, 16, BlendFactor_One);
	writeU32(d.view, 20, BlendFactor_OneMinusSrcAlpha);
	return d;
}

export function makePrimitiveState(
	topology: number = PrimitiveTopology_TriangleList,
	cullMode: number = CullMode_None,
): Descriptor {
	const d = descriptor(32);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, topology);
	writeU32(d.view, 12, 0);
	writeU32(d.view, 16, FrontFace_CCW);
	writeU32(d.view, 20, cullMode);
	writeU32(d.view, 24, 0);
	writeU32(d.view, 28, 0);
	return d;
}

export function makeMultisampleState(): Descriptor {
	const d = descriptor(24);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, 1);
	writeU32(d.view, 12, 0xffffffff);
	writeU32(d.view, 16, 0);
	writeU32(d.view, 20, 0);
	return d;
}

/**
 * Writes a complete WGPURenderPipelineDescriptor by copying the inline
 * vertex/primitive/multisample states. Pass `layoutPtr = 0` for an
 * auto-derived pipeline layout. The vertex/primitive/multisample structs'
 * ArrayBuffers must remain alive at least until creation returns.
 */
export function makeRenderPipelineDescriptor(
	vertexState: Descriptor,
	primitiveState: Descriptor,
	multisampleState: Descriptor,
	fragmentStatePtr: number,
	layoutPtr: number = 0,
): Descriptor {
	const d = descriptor(168);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, layoutPtr);
	writeU64(d.view, 16, 0n);
	writePtr(d.view, 24, 0);
	new Uint8Array(d.buffer, 32, 64).set(new Uint8Array(vertexState.buffer));
	new Uint8Array(d.buffer, 96, 32).set(new Uint8Array(primitiveState.buffer));
	writePtr(d.view, 128, 0);
	new Uint8Array(d.buffer, 136, 24).set(new Uint8Array(multisampleState.buffer));
	writePtr(d.view, 160, fragmentStatePtr);
	return d;
}

// ---------- Buffers / textures ----------

export function makeBufferDescriptor(size: number, usage: bigint): Descriptor {
	const d = descriptor(48);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, 0);
	writeU64(d.view, 16, 0n);
	writeU64(d.view, 24, usage);
	writeU64(d.view, 32, BigInt(size));
	writeU32(d.view, 40, 0);
	writeU32(d.view, 44, 0);
	return d;
}

export function makeTextureDescriptor(
	width: number,
	height: number,
	format: number,
	usage: bigint,
): Descriptor {
	const d = descriptor(80);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, 0);
	writeU64(d.view, 16, 0n);
	writeU64(d.view, 24, usage);
	writeU32(d.view, 32, TextureDimension_2D);
	writeU32(d.view, 36, width);
	writeU32(d.view, 40, height);
	writeU32(d.view, 44, 1);
	writeU32(d.view, 48, format);
	writeU32(d.view, 52, 1);
	writeU32(d.view, 56, 1);
	writeU32(d.view, 60, 0);
	writeU64(d.view, 64, 0n);
	writePtr(d.view, 72, 0);
	return d;
}

export function makeSamplerDescriptor(): Descriptor {
	const d = descriptor(64);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, 0);
	writeU64(d.view, 16, 0n);
	writeU32(d.view, 24, AddressMode_ClampToEdge);
	writeU32(d.view, 28, AddressMode_ClampToEdge);
	writeU32(d.view, 32, AddressMode_ClampToEdge);
	writeU32(d.view, 36, FilterMode_Linear);
	writeU32(d.view, 40, FilterMode_Linear);
	writeU32(d.view, 44, MipmapFilterMode_Linear);
	d.view.setFloat32(48, 0, true);
	d.view.setFloat32(52, 32, true);
	writeU32(d.view, 56, 0);
	d.view.setUint16(60, 1, true);
	d.view.setUint16(62, 0, true);
	return d;
}

// ---------- Bind groups ----------

export function makeBindGroupEntryBuffer(
	binding: number,
	bufferPtr: number,
	offset: number,
	size: number,
): Descriptor {
	const d = descriptor(56);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, binding);
	writeU32(d.view, 12, 0);
	writePtr(d.view, 16, bufferPtr);
	writeU64(d.view, 24, BigInt(offset));
	writeU64(d.view, 32, BigInt(size));
	writePtr(d.view, 40, 0);
	writePtr(d.view, 48, 0);
	return d;
}

export function makeBindGroupEntrySampler(binding: number, samplerPtr: number): Descriptor {
	const d = descriptor(56);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, binding);
	writeU32(d.view, 12, 0);
	writePtr(d.view, 16, 0);
	writeU64(d.view, 24, 0n);
	writeU64(d.view, 32, 0n);
	writePtr(d.view, 40, samplerPtr);
	writePtr(d.view, 48, 0);
	return d;
}

export function makeBindGroupEntryTexture(binding: number, textureViewPtr: number): Descriptor {
	const d = descriptor(56);
	writePtr(d.view, 0, 0);
	writeU32(d.view, 8, binding);
	writeU32(d.view, 12, 0);
	writePtr(d.view, 16, 0);
	writeU64(d.view, 24, 0n);
	writeU64(d.view, 32, 0n);
	writePtr(d.view, 40, 0);
	writePtr(d.view, 48, textureViewPtr);
	return d;
}

export function makeBindGroupEntries(entries: Descriptor[]): Descriptor {
	const ENTRY_SIZE = 56;
	const buffer = new ArrayBuffer(ENTRY_SIZE * entries.length);
	const dst = new Uint8Array(buffer);
	for (let i = 0; i < entries.length; i++) {
		dst.set(new Uint8Array(entries[i].buffer), ENTRY_SIZE * i);
	}
	return { buffer, ptr: ptr(buffer) as number };
}

export function makeBindGroupDescriptor(
	layoutPtr: number,
	entriesPtr: number,
	count: number,
): Descriptor {
	const d = descriptor(48);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, 0);
	writeU64(d.view, 16, 0n);
	writePtr(d.view, 24, layoutPtr);
	writeU64(d.view, 32, BigInt(count));
	writePtr(d.view, 40, entriesPtr);
	return d;
}

// ---------- Texture copy / extents ----------

export function makeTexelCopyTextureInfo(texturePtr: number): Descriptor {
	const d = descriptor(32);
	writePtr(d.view, 0, texturePtr);
	writeU32(d.view, 8, 0);
	writeU32(d.view, 12, 0);
	writeU32(d.view, 16, 0);
	writeU32(d.view, 20, 0);
	writeU32(d.view, 24, TextureAspect_All);
	writeU32(d.view, 28, 0);
	return d;
}

export function makeTexelCopyBufferLayout(
	bytesPerRow: number,
	rowsPerImage: number,
): Descriptor {
	const d = descriptor(16);
	writeU64(d.view, 0, 0n);
	writeU32(d.view, 8, bytesPerRow);
	writeU32(d.view, 12, rowsPerImage);
	return d;
}

export function makeExtent3D(width: number, height: number, depth: number): Descriptor {
	const d = descriptor(12);
	writeU32(d.view, 0, width);
	writeU32(d.view, 4, height);
	writeU32(d.view, 8, depth);
	return d;
}

// ---------- Render pass ----------

export type ClearColor = [number, number, number, number];

export function makeRenderPassColorAttachment(
	viewPtr: number,
	clear: ClearColor = [0, 0, 0, 1],
	loadOp: number = LoadOp_Clear,
): Descriptor {
	const d = descriptor(72);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, viewPtr);
	writeU32(d.view, 16, DEPTH_SLICE_UNDEFINED);
	writeU32(d.view, 20, 0);
	writePtr(d.view, 24, 0);
	writeU32(d.view, 32, loadOp);
	writeU32(d.view, 36, StoreOp_Store);
	writeF64(d.view, 40, clear[0]);
	writeF64(d.view, 48, clear[1]);
	writeF64(d.view, 56, clear[2]);
	writeF64(d.view, 64, clear[3]);
	return d;
}

export function makeRenderPassDescriptor(colorAttachmentPtr: number): Descriptor {
	const d = descriptor(64);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, 0);
	writeU64(d.view, 16, 0n);
	writeU64(d.view, 24, 1n);
	writePtr(d.view, 32, colorAttachmentPtr);
	writePtr(d.view, 40, 0);
	writePtr(d.view, 48, 0);
	writePtr(d.view, 56, 0);
	return d;
}

export function makeCommandEncoderDescriptor(): Descriptor {
	const d = descriptor(24);
	writePtr(d.view, 0, 0);
	writePtr(d.view, 8, 0);
	writeU64(d.view, 16, 0n);
	return d;
}

export function makeCommandBufferArray(cmdPtr: number) {
	const buffer = new BigUint64Array([BigInt(cmdPtr)]);
	return { buffer, ptr: ptr(buffer) as number };
}

// ---------- Misc ----------

export function alignTo(value: number, alignment: number): number {
	return Math.ceil(value / alignment) * alignment;
}
