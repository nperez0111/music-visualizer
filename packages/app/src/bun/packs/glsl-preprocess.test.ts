import { describe, expect, test } from "bun:test";
import { preprocessGlsl } from "./glsl-preprocess";

describe("preprocessGlsl", () => {
	test("rejects empty source", () => {
		const r = preprocessGlsl("");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/empty/);
	});

	test("rejects whitespace-only source", () => {
		const r = preprocessGlsl("   \n\n  ");
		expect(r.ok).toBe(false);
	});

	test("rejects source with no entry point", () => {
		const r = preprocessGlsl("float foo() { return 1.0; }");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/mainImage|void main/);
	});

	// ---- Shadertoy convention: mainImage ----

	test("processes minimal Shadertoy shader", () => {
		const src = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(1.0, 0.0, 0.0, 1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.hadMainImage).toBe(true);
		expect(r.glsl).toContain("#version 450");
		expect(r.glsl).toContain("layout(set=0, binding=0) uniform Uniforms");
		expect(r.glsl).toContain("#define iTime");
		expect(r.glsl).toContain("#define iResolution");
		expect(r.glsl).toContain("#define iTimeDelta");
		expect(r.glsl).toContain("void main()");
		expect(r.glsl).toContain("mainImage(_fragColor, gl_FragCoord.xy)");
	});

	test("injects Cat Nip audio uniforms", () => {
		const src = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(bass, mid, treble, 1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// The uniform block should contain audio fields
		expect(r.glsl).toContain("float rms;");
		expect(r.glsl).toContain("float bass;");
		expect(r.glsl).toContain("float mid;");
		expect(r.glsl).toContain("float treble;");
		expect(r.glsl).toContain("float bpm;");
		expect(r.glsl).toContain("float beat_phase;");
		expect(r.glsl).toContain("vec4  spectrum[8];");
	});

	// ---- void main() convention ----

	test("accepts shader with void main() (no mainImage)", () => {
		const src = `
layout(location=0) out vec4 outColor;
void main() {
  outColor = vec4(0.0, 1.0, 0.0, 1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.hadMainImage).toBe(false);
		// Should NOT inject the mainImage wrapper
		expect(r.glsl).not.toContain("mainImage(_fragColor");
	});

	test("injects layout(location=0) out when void main() lacks it", () => {
		const src = `
void main() {
  gl_FragColor = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("layout(location=0) out vec4 _fragColor;");
	});

	test("does NOT inject layout out when it already exists", () => {
		const src = `
layout(location=0) out vec4 myColor;
void main() {
  myColor = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should only have the user's own layout out, not a duplicate
		const matches = r.glsl.match(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*out\s+vec4/g);
		expect(matches?.length).toBe(1);
	});

	// ---- #version handling ----

	test("does NOT prepend #version if already present", () => {
		const src = `#version 450
void main() { }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		const versionCount = (r.glsl.match(/#version/g) || []).length;
		expect(versionCount).toBe(1);
	});

	test("prepends #version 450 if missing", () => {
		const src = `void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toMatch(/^#version 450/);
	});

	// ---- Uniform block injection ----

	test("skips uniform block injection if already present", () => {
		const src = `
layout(set=0, binding=0) uniform Uniforms {
  float time_ms;
};
void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(time_ms); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should only have one uniform block
		const uniformBlocks = r.glsl.match(/layout\s*\(\s*set\s*=\s*0\s*,\s*binding\s*=\s*0\s*\)\s*uniform/g);
		expect(uniformBlocks?.length).toBe(1);
	});

	// ---- Shadertoy alias stripping ----

	test("strips existing #define iTime to avoid DefineRedefined", () => {
		const src = `
#define iTime someOtherThing
void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(iTime); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// The user's #define should be commented out
		expect(r.glsl).toContain("// [stripped duplicate]");
		// Our own #define iTime should still be present
		expect(r.glsl).toContain("#define iTime       (time_ms / 1000.0)");
	});

	// ---- mat2 fixup ----

	test("rewrites mat2(a,b,c,d) to mat2(vec2(a,b), vec2(c,d))", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  mat2 m = mat2(cos(t), sin(t), -sin(t), cos(t));
  fc = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("mat2(vec2(cos(t), sin(t)), vec2(-sin(t), cos(t)))");
	});

	test("does NOT rewrite mat2 when args are already vec2", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  mat2 m = mat2(vec2(1.0, 0.0), vec2(0.0, 1.0));
  fc = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should remain unchanged
		expect(r.glsl).toContain("mat2(vec2(1.0, 0.0), vec2(0.0, 1.0))");
	});

	// ---- Edge cases ----

	test("handles mainImage with unusual whitespace", () => {
		const src = `void   mainImage (  out   vec4  color ,  in   vec2  coord  ) { color = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hadMainImage).toBe(true);
	});

	test("handles mainImage(void) as invalid (no entry point)", () => {
		// mainImage must have the out vec4 / in vec2 signature
		const src = `void mainImage(void) { }`;
		const r = preprocessGlsl(src);
		// This won't match the mainImage regex, and also won't match void main()
		expect(r.ok).toBe(false);
	});

	test("preserves user code verbatim (minus fixups)", () => {
		const userCode = `
// My custom shader
const float PI = 3.14159265;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}`;
		const r = preprocessGlsl(userCode);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// User's function and constant should be preserved
		expect(r.glsl).toContain("const float PI = 3.14159265;");
		expect(r.glsl).toContain("float hash(vec2 p)");
	});

	// ---- Parameter injection ----

	test("injects parameter block when parameters provided", () => {
		const src = `void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src, {
			parameters: [{ name: "speed" }, { name: "tint" }, { name: "intensity" }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("layout(set=1, binding=0) uniform Params");
		expect(r.glsl).toContain("vec4 speed;");
		expect(r.glsl).toContain("vec4 tint;");
		expect(r.glsl).toContain("vec4 intensity;");
	});

	test("does NOT inject parameter block when no parameters", () => {
		const src = `void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("layout(set=1");
		expect(r.glsl).not.toContain("uniform Params");
	});

	test("does NOT inject parameter block when empty array", () => {
		const src = `void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src, { parameters: [] });
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("uniform Params");
	});

	test("skips parameter block if user declared set=1 binding manually", () => {
		const src = `
layout(set=1, binding=0) uniform Params { vec4 speed; };
void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(speed.x); }`;
		const r = preprocessGlsl(src, {
			parameters: [{ name: "speed" }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should only have one set=1 block (the user's, not a duplicate)
		const matches = r.glsl.match(/layout\s*\(\s*set\s*=\s*1/g);
		expect(matches?.length).toBe(1);
	});

	// ---- Prev-frame feedback injection ----

	test("auto-detects prev_tex usage and injects bindings", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  vec4 prev = texture(sampler2D(prev_tex, prev_sampler), uv);
  fc = prev * 0.95 + vec4(bass * 0.1);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("layout(set=2, binding=0) uniform sampler prev_sampler;");
		expect(r.glsl).toContain("layout(set=2, binding=1) uniform texture2D prev_tex;");
	});

	test("injects prev-frame bindings when prevFrame option is true", () => {
		const src = `void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src, { prevFrame: true });
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("layout(set=2, binding=0) uniform sampler prev_sampler;");
		expect(r.glsl).toContain("layout(set=2, binding=1) uniform texture2D prev_tex;");
	});

	test("does NOT inject prev-frame bindings if user declared set=2 manually", () => {
		const src = `
layout(set=2, binding=0) uniform sampler mySampler;
layout(set=2, binding=1) uniform texture2D myTex;
void mainImage(out vec4 fc, in vec2 fp) {
  fc = texture(sampler2D(myTex, mySampler), fp / iResolution.xy);
}`;
		const r = preprocessGlsl(src, { prevFrame: true });
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should only have the user's set=2 declarations, not duplicates
		const matches = r.glsl.match(/layout\s*\(\s*set\s*=\s*2/g);
		expect(matches?.length).toBe(2); // the 2 the user already declared
	});

	test("does NOT inject prev-frame bindings when not needed", () => {
		const src = `void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("layout(set=2");
	});

	// ---- Inter-pass injection ----

	test("auto-detects pass_tex usage and injects bindings", () => {
		const src = `
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec4 src = texture(sampler2D(pass_tex, pass_sampler), uv);
  _fragColor = src;
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("layout(set=3, binding=0) uniform sampler pass_sampler;");
		expect(r.glsl).toContain("layout(set=3, binding=1) uniform texture2D pass_tex;");
	});

	test("injects inter-pass bindings when interPass option is true", () => {
		const src = `void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src, { interPass: true });
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("layout(set=3, binding=0) uniform sampler pass_sampler;");
		expect(r.glsl).toContain("layout(set=3, binding=1) uniform texture2D pass_tex;");
	});

	// ---- Combined: parameters + prev-frame ----

	test("injects both parameter block and prev-frame bindings", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  vec4 prev = texture(sampler2D(prev_tex, prev_sampler), uv);
  fc = prev * speed.x + vec4(tint.xyz, 1.0);
}`;
		const r = preprocessGlsl(src, {
			parameters: [{ name: "speed" }, { name: "tint" }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Params at set=1
		expect(r.glsl).toContain("layout(set=1, binding=0) uniform Params");
		expect(r.glsl).toContain("vec4 speed;");
		expect(r.glsl).toContain("vec4 tint;");
		// Prev-frame at set=2
		expect(r.glsl).toContain("layout(set=2, binding=0) uniform sampler prev_sampler;");
		expect(r.glsl).toContain("layout(set=2, binding=1) uniform texture2D prev_tex;");
	});
});
