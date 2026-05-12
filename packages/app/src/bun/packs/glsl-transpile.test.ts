import { describe, expect, test } from "bun:test";
import { transpileGlslToWgsl } from "./glsl-transpile";
import { findNagaBinary } from "../paths";

// Skip all transpiler tests if naga-cli is not installed
const nagaAvailable = findNagaBinary() !== null;

describe("transpileGlslToWgsl", () => {
	test.skipIf(!nagaAvailable)("transpiles minimal Shadertoy shader", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Should have vertex shader
		expect(r.wgsl).toContain("fn vs_main");
		expect(r.wgsl).toContain("@vertex");

		// Should have renamed fragment entry point
		expect(r.wgsl).toContain("fn fs_main");
		expect(r.wgsl).toContain("@fragment");

		// Should use `_cn_u.` for uniform access (not `global.`)
		expect(r.wgsl).not.toContain("global.");
	});

	test.skipIf(!nagaAvailable)("transpiles shader using Cat Nip audio uniforms", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float energy = bass * 0.5 + mid * 0.3 + treble * 0.2;
  fragColor = vec4(uv * energy, beat_phase, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Should reference _cn_u.bass, _cn_u.mid, etc. (Naga maps struct fields → _cn_u.field)
		expect(r.wgsl).toContain("_cn_u.");
	});

	test.skipIf(!nagaAvailable)("transpiles shader with void main()", () => {
		const glsl = `
layout(location=0) out vec4 outColor;
void main() {
  outColor = vec4(1.0, 0.0, 0.0, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		expect(r.wgsl).toContain("fn vs_main");
		expect(r.wgsl).toContain("fn fs_main");
	});

	test("fails gracefully on invalid GLSL", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  this is not valid GLSL at all!!!
}`;
		const r = transpileGlslToWgsl(glsl);
		// Should fail at naga stage (preprocessing succeeds but naga rejects it)
		if (!r.ok) {
			expect(r.stage).toBe("naga");
		}
		// If naga happens to not be installed, it still won't be ok: true
		expect(r.ok).toBe(false);
	});

	test("fails on empty source", () => {
		const r = transpileGlslToWgsl("");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.stage).toBe("preprocess");
	});

	test("fails on source with no entry point", () => {
		const r = transpileGlslToWgsl("float x = 1.0;");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.stage).toBe("preprocess");
	});

	test.skipIf(!nagaAvailable)("transpiles plasma-like shader with math functions", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float t = iTime;
  float v = sin(uv.x * 10.0 + t) + sin(uv.y * 10.0 + t);
  v += sin((uv.x + uv.y) * 10.0 + t);
  v += sin(length(uv - 0.5) * 20.0 - t * 2.0);
  v = v / 4.0 + 0.5;
  fragColor = vec4(v, v * 0.5, 1.0 - v, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Verify structural correctness
		expect(r.wgsl).toContain("fn vs_main");
		expect(r.wgsl).toContain("fn fs_main");
		expect(r.wgsl).toContain("struct Uniforms");
	});

	test.skipIf(!nagaAvailable)("includes spectrum array in uniform struct", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 s = spectrum[0];
  fragColor = vec4(s.x, s.y, s.z, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// The uniform struct should contain spectrum
		expect(r.wgsl).toContain("spectrum");
	});

	test.skipIf(!nagaAvailable)("output has no duplicate @vertex decorators", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		const vertexCount = (r.wgsl.match(/@vertex/g) || []).length;
		expect(vertexCount).toBe(1);
	});

	test.skipIf(!nagaAvailable)("output has exactly one @fragment decorator", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		const fragmentCount = (r.wgsl.match(/@fragment/g) || []).length;
		expect(fragmentCount).toBe(1);
	});

	// ---- Parameter support ----

	test.skipIf(!nagaAvailable)("transpiles shader with parameters", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = tint.xyz * speed.x;
  fragColor = vec4(col, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl, {
			parameters: [{ name: "speed" }, { name: "tint" }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Should have Params struct
		expect(r.wgsl).toContain("struct Params");
		expect(r.wgsl).toContain("speed");
		expect(r.wgsl).toContain("tint");

		// Should use `_cn_p.` for parameter access (not `global_1.`)
		expect(r.wgsl).toContain("_cn_p.");
		expect(r.wgsl).not.toContain("global_1.");

		// Should have @group(1) binding
		expect(r.wgsl).toContain("@group(1)");
	});

	test.skipIf(!nagaAvailable)("transpiles shader without parameters (no @group(1))", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(bass, mid, treble, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		// Should NOT have @group(1)
		expect(r.wgsl).not.toContain("@group(1)");
		expect(r.wgsl).not.toContain("struct Params");
	});

	// ---- Prev-frame feedback ----

	test.skipIf(!nagaAvailable)("transpiles shader with prev-frame feedback", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 prev = texture(sampler2D(prev_tex, prev_sampler), uv);
  fragColor = prev * 0.95 + vec4(bass * 0.1, 0.0, 0.0, 0.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Should have @group(2) bindings for prev-frame
		expect(r.wgsl).toContain("@group(2)");
		expect(r.wgsl).toContain("prev_sampler");
		expect(r.wgsl).toContain("prev_tex");
		// Should use textureSample (Naga converts texture(sampler2D(...)))
		expect(r.wgsl).toContain("textureSample");
	});

	// ---- Combined: parameters + prev-frame ----

	test.skipIf(!nagaAvailable)("transpiles shader with both parameters and prev-frame", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 prev = texture(sampler2D(prev_tex, prev_sampler), uv);
  vec3 col = mix(prev.rgb * 0.95, tint.xyz, 0.1 + bass * 0.2);
  col += 0.1 * sin(uv.x * 10.0 + iTime) * speed.x;
  fragColor = vec4(col, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl, {
			parameters: [{ name: "speed" }, { name: "tint" }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Uniforms at @group(0) with `_cn_u.` access
		expect(r.wgsl).toContain("@group(0)");
		expect(r.wgsl).toContain("_cn_u.");

		// Params at @group(1) with `_cn_p.` access
		expect(r.wgsl).toContain("@group(1)");
		expect(r.wgsl).toContain("_cn_p.");

		// Prev-frame at @group(2)
		expect(r.wgsl).toContain("@group(2)");

		// No stale Naga variable names
		expect(r.wgsl).not.toMatch(/\bglobal\./);
		expect(r.wgsl).not.toContain("global_1.");
	});

	// ---- Variable name collisions ----

	test.skipIf(!nagaAvailable)("local `vec2 u` does not shadow uniform access", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 u = fragCoord.xy;
  vec2 uv = u / iResolution.xy;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Uniform access must use _cn_u (collision-safe), not bare `u`
		expect(r.wgsl).toContain("_cn_u.");
		// The local `u` variable should NOT be renamed
		expect(r.wgsl).toContain("var u:");
	});

	test.skipIf(!nagaAvailable)("local `vec3 p` does not shadow param access", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 p = vec3(fragCoord, 0.0);
  fragColor = vec4(p * speed.x, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl, {
			parameters: [{ name: "speed" }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Param access must use _cn_p (collision-safe), not bare `p`
		expect(r.wgsl).toContain("_cn_p.");
		// The local `p` variable should NOT be renamed
		expect(r.wgsl).toContain("var p:");
	});

	// ---- Inter-pass ----

	test.skipIf(!nagaAvailable)("transpiles shader with inter-pass input", () => {
		const glsl = `
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec4 src = texture(sampler2D(pass_tex, pass_sampler), uv);
  float bright = max(max(src.r, src.g), src.b);
  _fragColor = src + src * smoothstep(0.6, 1.0, bright) * 0.3;
}`;
		const r = transpileGlslToWgsl(glsl, { interPass: true });
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		// Should have @group(3) bindings for inter-pass
		expect(r.wgsl).toContain("@group(3)");
		expect(r.wgsl).toContain("pass_sampler");
		expect(r.wgsl).toContain("pass_tex");
	});

	// ---- Shadertoy compatibility: iGlobalTime ----

	test.skipIf(!nagaAvailable)("transpiles shader using iGlobalTime (legacy alias)", () => {
		const glsl = `
void mainImage(out vec4 f, vec2 p) {
  p /= iResolution.xy;
  f = vec4(p, .5+.5*sin(iGlobalTime), 1);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		expect(r.wgsl).toContain("fn fs_main");
		expect(r.wgsl).toContain("fn vs_main");
	});

	// ---- Shadertoy compatibility: mainImage without `in` keyword ----

	test.skipIf(!nagaAvailable)("transpiles mainImage without `in` keyword", () => {
		const glsl = `
void mainImage(out vec4 fragColor, vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		expect(r.wgsl).toContain("fn fs_main");
		expect(r.wgsl).toContain("fn vs_main");
	});

	// ---- Shadertoy compatibility: iChannel texture stubs ----

	test.skipIf(!nagaAvailable)("transpiles shader with iChannel0 texture calls (stubbed)", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 tex = texture(iChannel0, uv);
  fragColor = tex + vec4(0.1);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		expect(r.wgsl).toContain("fn fs_main");
		// iChannel0 references should be gone (stubbed to vec4(0.0))
		expect(r.wgsl).not.toContain("iChannel");
	});

	test.skipIf(!nagaAvailable)("transpiles shader with texture2D + iChannel0 (legacy GLSL)", () => {
		const glsl = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = texture2D(iChannel0, uv);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		expect(r.wgsl).toContain("fn fs_main");
	});

	// ---- Shadertoy compatibility: precision qualifiers ----

	test.skipIf(!nagaAvailable)("transpiles shader with precision qualifiers", () => {
		const glsl = `
precision mediump float;
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		expect(r.wgsl).toContain("fn fs_main");
	});

	// ---- Shadertoy compatibility: sampler2D function params with iChannel ----

	test.skipIf(!nagaAvailable)("transpiles shader with sampler2D function params + iChannel (tri-planar texture)", () => {
		const glsl = `
vec3 tex3D(sampler2D tex, in vec3 p, in vec3 n) {
  n = max((abs(n) - .2), .001);
  n /= (n.x + n.y + n.z);
  p = (texture(tex, p.yz)*n.x + texture(tex, p.zx)*n.y + texture(tex, p.xy)*n.z).xyz;
  return p*p;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = tex3D(iChannel0, vec3(uv, 0.0), vec3(0.0, 0.0, 1.0));
  fragColor = vec4(col, 1.0);
}`;
		const r = transpileGlslToWgsl(glsl);
		expect(r.ok).toBe(true);
		if (!r.ok) {
			console.error("Transpile error:", r.error, "stage:", r.stage);
			return;
		}

		expect(r.wgsl).toContain("fn fs_main");
		expect(r.wgsl).toContain("fn vs_main");
		// Should not contain any iChannel references
		expect(r.wgsl).not.toContain("iChannel");
	});
});
