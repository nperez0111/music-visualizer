// Tier-2 sample pack: produces 16 bytes of pack-defined uniforms each frame.
//
// Layout written to pack memory (matches the WGSL `packData: vec4<f32>`):
//   offset  0..3 : r          (f32)
//   offset  4..7 : g          (f32)
//   offset  8..11: b          (f32)
//   offset 12..15: energy     (f32, accumulated bass)

let energy: f32 = 0.0;
let outputPtr: i32 = 0;

export function viz_pack_uniform_size(): u32 {
	return 16;
}

export function viz_init(_featureCount: u32, _parameterCount: u32): u32 {
	const buf = new StaticArray<u8>(16);
	outputPtr = changetype<i32>(buf);
	energy = 0.0;
	return 1;
}

export function viz_frame(
	_handle: u32,
	timeMs: f32,
	featuresPtr: u32,
	_paramsPtr: u32,
): u32 {
	// Audio features layout (host-provided):
	//  0 rms, 4 peak, 8 bass, 12 mid, 16 treble, 20 bpm, 24 beat_phase, 28 pad
	const bass: f32 = load<f32>(featuresPtr + 8);
	const mid: f32 = load<f32>(featuresPtr + 12);
	const treble: f32 = load<f32>(featuresPtr + 16);

	energy = energy * 0.96 + bass * 0.04;

	const t: f32 = timeMs * 0.001;
	const r: f32 = <f32>0.5 + <f32>0.5 * Mathf.sin(t * 0.7 + bass * 3.5);
	const g: f32 = <f32>0.5 + <f32>0.5 * Mathf.sin(t * 0.9 + mid * 3.0);
	const b: f32 = <f32>0.5 + <f32>0.5 * Mathf.sin(t * 1.3 + treble * 3.0);

	store<f32>(outputPtr + 0, r);
	store<f32>(outputPtr + 4, g);
	store<f32>(outputPtr + 8, b);
	store<f32>(outputPtr + 12, energy);

	return <u32>outputPtr;
}

export function viz_dispose(_handle: u32): void {
	// no-op (stub runtime; nothing to free)
}
