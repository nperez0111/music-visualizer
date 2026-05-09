// Tier 2 pack: WASM-driven Verlet particle fountain.
//
// Output layout (matches WGSL `particles: array<vec4<f32>, 16>`):
//   per particle: x, y, size_alive, hue   (16 bytes)
// Total written per frame: 16 * 16 = 256 bytes.
//
// Internal state per particle (8 floats, host-invisible):
//   x, y, vx, vy, life01, hue, baseSize, _pad

@external("env", "host_random")
declare function host_random(): f32;

const NUM_PARTICLES: i32 = 16;
const STATE_FLOATS: i32 = 8;             // per-particle internal state stride (floats)
const OUTPUT_FLOATS: i32 = 4;            // per-particle public state stride (floats)
const STATE_BYTES: i32 = NUM_PARTICLES * STATE_FLOATS * 4;
const OUTPUT_BYTES: i32 = NUM_PARTICLES * OUTPUT_FLOATS * 4;

let statePtr: i32 = 0;
let outputPtr: i32 = 0;
let lastTimeMs: f32 = -1.0;
let lastBeatPhase: f32 = 0.0;
let hasSeeded: bool = false;

export function viz_pack_uniform_size(): u32 {
	return <u32>OUTPUT_BYTES;
}

export function viz_init(_featureCount: u32, _parameterCount: u32): u32 {
	const stateBuf = new StaticArray<u8>(STATE_BYTES);
	statePtr = changetype<i32>(stateBuf);
	const outBuf = new StaticArray<u8>(OUTPUT_BYTES);
	outputPtr = changetype<i32>(outBuf);
	for (let i: i32 = 0; i < STATE_BYTES; i++) store<u8>(statePtr + i, 0);
	for (let i: i32 = 0; i < OUTPUT_BYTES; i++) store<u8>(outputPtr + i, 0);
	return 1;
}

function spawnParticle(slot: i32, bass: f32): void {
	const o = statePtr + slot * STATE_FLOATS * 4;
	// Spawn cone: angles between ~-100° and ~-80° (mostly straight up, slight spread).
	// Screen coords: y = +1 at bottom, y = -1 at top, so "up" is negative vy.
	const spread: f32 = 0.6;
	const angle: f32 = -<f32>1.5708 + (host_random() - <f32>0.5) * spread;
	const speed: f32 = <f32>1.4 + host_random() * (<f32>0.7 + bass * <f32>1.4);
	const x: f32 = (host_random() - <f32>0.5) * <f32>0.45;
	const y: f32 = <f32>0.85;
	const vx: f32 = Mathf.cos(angle) * speed;
	const vy: f32 = Mathf.sin(angle) * speed;
	const hue: f32 = host_random();
	const size: f32 = <f32>0.045 + host_random() * <f32>0.07;
	store<f32>(o + 0, x);
	store<f32>(o + 4, y);
	store<f32>(o + 8, vx);
	store<f32>(o + 12, vy);
	store<f32>(o + 16, <f32>1.0);
	store<f32>(o + 20, hue);
	store<f32>(o + 24, size);
	store<f32>(o + 28, 0);
}

export function viz_frame(
	_handle: u32,
	timeMs: f32,
	featuresPtr: u32,
	_paramsPtr: u32,
): u32 {
	// Audio features: rms, peak, bass, mid, treble, bpm, beat_phase, _pad.
	const peak: f32 = load<f32>(featuresPtr + 4);
	const bass: f32 = load<f32>(featuresPtr + 8);
	const treble: f32 = load<f32>(featuresPtr + 16);
	const beatPhase: f32 = load<f32>(featuresPtr + 24);

	let dtMs: f32 = lastTimeMs < <f32>0 ? <f32>16.0 : timeMs - lastTimeMs;
	if (dtMs > <f32>50.0) dtMs = <f32>50.0; // big tab-pause guard
	const dt: f32 = dtMs * <f32>0.001;
	lastTimeMs = timeMs;

	// Beat detected when phase wraps 0.95-ish -> 0.05-ish.
	const beat: bool = beatPhase < lastBeatPhase - <f32>0.4;
	lastBeatPhase = beatPhase;

	// Wind bias from treble (centered around 0.5 = no wind).
	const wind: f32 = (treble - <f32>0.5) * <f32>1.6;
	const gravity: f32 = <f32>1.6;

	// Seed a small initial spawn the first frame so we don't open on a black screen.
	let spawnsLeft: i32 = 0;
	if (!hasSeeded) {
		hasSeeded = true;
		spawnsLeft = 4;
	}
	if (beat) spawnsLeft += 5;
	// Light continuous trickle so motion never fully stops.
	if (host_random() < <f32>0.05 + peak * <f32>0.15) spawnsLeft += 1;

	for (let i: i32 = 0; i < NUM_PARTICLES; i++) {
		const o = statePtr + i * STATE_FLOATS * 4;
		let life: f32 = load<f32>(o + 16);

		if (life <= <f32>0.0) {
			if (spawnsLeft > 0) {
				spawnParticle(i, bass);
				spawnsLeft -= 1;
			}
			continue;
		}

		let x: f32 = load<f32>(o + 0);
		let y: f32 = load<f32>(o + 4);
		let vx: f32 = load<f32>(o + 8);
		let vy: f32 = load<f32>(o + 12);

		vy = vy + gravity * dt;
		vx = vx + wind * dt;
		x = x + vx * dt;
		y = y + vy * dt;
		life = life - dt * <f32>0.5;

		// Off-screen kill (wide bounds; particles can arc).
		if (y > <f32>1.4 || x < <f32>-1.8 || x > <f32>1.8) life = <f32>0.0;

		store<f32>(o + 0, x);
		store<f32>(o + 4, y);
		store<f32>(o + 8, vx);
		store<f32>(o + 12, vy);
		store<f32>(o + 16, life);
	}

	// Pack output: per-particle (x, y, size*life_eased, hue).
	for (let i: i32 = 0; i < NUM_PARTICLES; i++) {
		const sIn = statePtr + i * STATE_FLOATS * 4;
		const sOut = outputPtr + i * OUTPUT_FLOATS * 4;
		const life: f32 = load<f32>(sIn + 16);
		const ease: f32 = life > <f32>0.0 ? Mathf.sqrt(life) : <f32>0.0;
		store<f32>(sOut + 0, load<f32>(sIn + 0));
		store<f32>(sOut + 4, load<f32>(sIn + 4));
		store<f32>(sOut + 8, load<f32>(sIn + 24) * ease);
		store<f32>(sOut + 12, load<f32>(sIn + 20));
	}

	return <u32>outputPtr;
}

export function viz_dispose(_handle: u32): void {}
