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
		// Y is flipped: wgpu has Y=0 at top, Shadertoy convention has Y=0 at bottom
		expect(r.glsl).toContain("resolution.y - gl_FragCoord.y");
		expect(r.glsl).toContain("mainImage(_fragColor, _fc)");
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

	test("rewrites mat2(vec4_expr) to _mat2v4(vec4_expr)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  mat2 m = mat2(cos(a + vec4(0, 33, 11, 0)));
  fc = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should rewrite to use the helper function
		expect(r.glsl).toContain("_mat2v4(cos(a + vec4(0, 33, 11, 0)))");
		// Should inject the helper
		expect(r.glsl).toContain("mat2 _mat2v4(vec4 v)");
		expect(r.glsl).toContain("return mat2(v.xy, v.zw);");
	});

	test("rewrites mat2(variable) to _mat2v4(variable)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec4 v = vec4(1.0, 0.0, 0.0, 1.0);
  mat2 m = mat2(v);
  fc = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("_mat2v4(v)");
	});

	test("does NOT rewrite mat2(float_literal) diagonal form", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  mat2 m = mat2(1.0);
  fc = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should remain unchanged — mat2(float) is a valid diagonal matrix
		expect(r.glsl).toContain("mat2(1.0)");
		expect(r.glsl).not.toContain("_mat2v4");
	});

	test("does NOT rewrite mat2(integer_literal) diagonal form", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  mat2 m = mat2(0);
  fc = vec4(1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("mat2(0)");
		expect(r.glsl).not.toContain("_mat2v4");
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

	// ---- mainImage without `in` keyword ----

	test("accepts mainImage without `in` keyword on vec2 param", () => {
		const src = `void mainImage(out vec4 f, vec2 p) { f = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.hadMainImage).toBe(true);
		expect(r.glsl).toContain("void main()");
		expect(r.glsl).toContain("mainImage(_fragColor, _fc)");
	});

	test("still accepts mainImage with `in` keyword", () => {
		const src = `void mainImage(out vec4 f, in vec2 p) { f = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hadMainImage).toBe(true);
	});

	// ---- iGlobalTime (legacy Shadertoy alias) ----

	test("defines iGlobalTime as alias for iTime", () => {
		const src = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(sin(iGlobalTime), 0.0, 0.0, 1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("#define iGlobalTime (time_ms / 1000.0)");
	});

	test("strips existing #define iGlobalTime", () => {
		const src = `
#define iGlobalTime myCustomThing
void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(iGlobalTime); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("// [stripped duplicate]");
		expect(r.glsl).toContain("#define iGlobalTime (time_ms / 1000.0)");
	});

	// ---- precision qualifier stripping ----

	test("strips precision mediump float", () => {
		const src = `
precision mediump float;
void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("// [stripped precision]");
		// The actual precision line should be commented out, not present raw
		expect(r.glsl).not.toMatch(/^precision\s+mediump\s+float\s*;/m);
	});

	test("strips precision highp float", () => {
		const src = `
precision highp float;
precision highp int;
void mainImage(out vec4 fc, in vec2 fp) { fc = vec4(1.0); }`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Both should be stripped
		const stripped = (r.glsl.match(/\[stripped precision\]/g) || []).length;
		expect(stripped).toBe(2);
	});

	// ---- texture2D → texture rewrite ----

	test("rewrites texture2D() to texture()", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  fc = vec4(uv, 0.0, 1.0);
}`;
		// Inject a texture2D call manually (in real usage, this would reference
		// a declared sampler, but we're just testing the rewrite)
		const srcWithTex2D = src.replace("vec4(uv, 0.0, 1.0)", "texture2D(mySampler, uv)");
		const r = preprocessGlsl(srcWithTex2D);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).toContain("texture(mySampler, uv)");
		expect(r.glsl).not.toContain("texture2D");
	});

	// ---- iChannel stubbing ----

	test("stubs texture(iChannel0, uv) → vec4(0.0)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  fc = texture(iChannel0, uv);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("iChannel0");
		expect(r.glsl).toContain("vec4(0.0)");
	});

	test("stubs texture2D(iChannel0, uv) → vec4(0.0)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  fc = texture2D(iChannel0, uv);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// texture2D should first be rewritten to texture, then the iChannel call stubbed
		expect(r.glsl).not.toContain("iChannel0");
		expect(r.glsl).toContain("vec4(0.0)");
	});

	test("stubs multiple iChannel references", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  vec4 a = texture(iChannel0, uv);
  vec4 b = texture(iChannel1, uv * 2.0);
  vec4 c = texture(iChannel2, uv + vec2(0.5));
  fc = a + b + c;
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("iChannel0");
		expect(r.glsl).not.toContain("iChannel1");
		expect(r.glsl).not.toContain("iChannel2");
	});

	test("stubs texelFetch(iChannel0, ...) → vec4(0.0)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  fc = texelFetch(iChannel0, ivec2(fp), 0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("iChannel0");
		expect(r.glsl).toContain("vec4(0.0)");
	});

	test("stubs textureLod(iChannel0, ...) → vec4(0.0)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  fc = textureLod(iChannel0, uv, 0.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("iChannel0");
		expect(r.glsl).toContain("vec4(0.0)");
	});

	test("does NOT stub texture calls without iChannel argument", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  vec4 prev = texture(sampler2D(prev_tex, prev_sampler), uv);
  fc = prev * 0.95;
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should preserve the non-iChannel texture call
		expect(r.glsl).toContain("texture(sampler2D(prev_tex, prev_sampler), uv)");
	});

	// ---- iChannelResolution / iChannelTime stubs ----

	test("stubs iChannelResolution[N] → vec3(resolution, 1.0)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec3 res = iChannelResolution[0];
  fc = vec4(res.xy / iResolution.xy, 0.0, 1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("iChannelResolution[0]");
		expect(r.glsl).toContain("vec3(resolution, 1.0)");
	});

	test("stubs iChannelTime[N] → (time_ms / 1000.0)", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  float t = iChannelTime[0];
  fc = vec4(sin(t), 0.0, 0.0, 1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.glsl).not.toContain("iChannelTime[0]");
		expect(r.glsl).toContain("(time_ms / 1000.0)");
	});

	// ---- sampler2D function parameter stubbing ----

	test("stubs sampler2D function params when iChannel is passed", () => {
		const src = `
vec3 tex3D(sampler2D tex, in vec3 p, in vec3 n) {
  n = max((abs(n) - .2), .001);
  n /= (n.x + n.y + n.z);
  p = (texture(tex, p.yz)*n.x + texture(tex, p.zx)*n.y + texture(tex, p.xy)*n.z).xyz;
  return p*p;
}
void mainImage(out vec4 fc, in vec2 fp) {
  vec3 col = tex3D(iChannel0, vec3(fp, 0.0), vec3(0.0, 0.0, 1.0));
  fc = vec4(col, 1.0);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// sampler2D should be replaced with int
		expect(r.glsl).not.toContain("sampler2D tex");
		expect(r.glsl).toContain("int tex");
		// texture(tex, ...) calls should be stubbed to vec4(0.0)
		expect(r.glsl).not.toContain("texture(tex,");
		// iChannel0 should be replaced with 0
		expect(r.glsl).not.toContain("iChannel0");
	});

	test("does NOT stub sampler2D functions when no iChannel is used", () => {
		const src = `
void mainImage(out vec4 fc, in vec2 fp) {
  vec2 uv = fp / iResolution.xy;
  vec4 prev = texture(sampler2D(prev_tex, prev_sampler), uv);
  fc = prev * 0.95;
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// sampler2D in texture(sampler2D(...)) should be preserved -- it's not a function param
		expect(r.glsl).toContain("sampler2D(prev_tex, prev_sampler)");
	});

	// ---- Code-golf style Shadertoy shader ----

	test("handles code-golf Shadertoy shader (iGlobalTime, no `in`, compact)", () => {
		const src = `void mainImage(out vec4 f, vec2 p){
  p /= iResolution.xy;
  f = vec4(p, .5+.5*sin(iGlobalTime), 1);
}`;
		const r = preprocessGlsl(src);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.hadMainImage).toBe(true);
		expect(r.glsl).toContain("#define iGlobalTime");
		expect(r.glsl).toContain("void main()");
	});
});
