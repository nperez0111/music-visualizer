/**
 * GLSL preprocessor: converts Shadertoy-convention GLSL (or Cat Nip-extended
 * GLSL) into Naga-compatible GLSL 450 that can be transpiled to WGSL.
 *
 * The preprocessor:
 *   1. Prepends `#version 450` if not already present
 *   2. Injects a uniform block matching Cat Nip's layout with explicit bindings
 *   3. Injects parameter block (set=1) when manifest declares parameters
 *   4. Injects prev-frame feedback bindings (set=2) when requested
 *   5. Injects inter-pass bindings (set=3) for extra-pass shaders
 *   6. Strips precision qualifiers (GLSL ES → GLSL 450)
 *   7. Adds Shadertoy compatibility aliases (#define iTime, iGlobalTime, iResolution, etc.)
 *   8. Rewrites texture2D() → texture() (GLSL 1.x → 4.5 compat)
 *   9. Stubs iChannel0-3 texture lookups → vec4(0.0) (no texture channel system)
 *  10. Applies fixups for common Naga failure patterns (mat2, etc.)
 *  11. Wraps `mainImage(out vec4, vec2)` into `void main()` with Y-flip
 */

// ---------------------------------------------------------------------------
// Uniform block injected into every preprocessed GLSL shader.
// Matches the Cat Nip uniform buffer layout (see ARCHITECTURE.md).
// ---------------------------------------------------------------------------

const UNIFORM_BLOCK = `
layout(set=0, binding=0) uniform Uniforms {
  float time_ms;
  float delta_ms;
  vec2  resolution;
  float rms;
  float peak;
  float bass;
  float mid;
  float treble;
  float bpm;
  float beat_phase;
  float _pad;
  vec4  spectrum[8];
};
`;

// ---------------------------------------------------------------------------
// Shadertoy compatibility aliases.
// These map standard Shadertoy uniform names to Cat Nip uniform fields.
// ---------------------------------------------------------------------------

const SHADERTOY_ALIASES = `
// Shadertoy compatibility aliases
#define iTime       (time_ms / 1000.0)
#define iGlobalTime (time_ms / 1000.0)
#define iResolution vec3(resolution, 1.0)
#define iTimeDelta  (delta_ms / 1000.0)
#define iFrame      int(time_ms / 16.6667)
#define iMouse      vec4(0.0)
#define iDate       vec4(0.0)
#define iSampleRate 44100.0
`;

// ---------------------------------------------------------------------------
// Entry-point wrapper: convert Shadertoy's mainImage into void main().
// ---------------------------------------------------------------------------

const ENTRY_WRAPPER = `
layout(location=0) out vec4 _fragColor;
void main() {
  // Flip Y: wgpu has Y=0 at top, Shadertoy convention has Y=0 at bottom.
  vec2 _fc = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y);
  mainImage(_fragColor, _fc);
}
`;

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Matches `void mainImage(out vec4 X, in vec2 Y)` with optional whitespace.
 * The `in` qualifier is optional — many Shadertoy shaders omit it since `in`
 * is the default parameter qualifier in GLSL.
 */
const MAIN_IMAGE_RE = /void\s+mainImage\s*\(\s*out\s+vec4\s+\w+\s*,\s*(in\s+)?vec2\s+\w+\s*\)/;

/** Matches an existing #version directive. */
const VERSION_RE = /^#version\s+\d+/m;

/** Matches an existing layout(set=0, binding=0) uniform block. */
const HAS_UNIFORM_BLOCK_RE = /layout\s*\(\s*set\s*=\s*0\s*,\s*binding\s*=\s*0\s*\)\s*uniform/;

/** Matches an existing layout(set=1, ...) declaration (user already declared params). */
const HAS_PARAM_BLOCK_RE = /layout\s*\(\s*set\s*=\s*1\s*,/;

/** Matches an existing layout(set=2, ...) declaration (user already declared prev-frame). */
const HAS_PREV_FRAME_RE = /layout\s*\(\s*set\s*=\s*2\s*,/;

/** Matches an existing layout(set=3, ...) declaration (user already declared inter-pass). */
const HAS_INTER_PASS_RE = /layout\s*\(\s*set\s*=\s*3\s*,/;

/**
 * Naga fails on mat2 constructed from 4 scalars; needs column-vector form.
 * We handle this in fixMat2Scalars() using a balanced-paren aware parser
 * rather than a regex, since arguments can contain nested function calls.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type PreprocessResult =
	| { ok: true; glsl: string; hadMainImage: boolean }
	| { ok: false; error: string };

/** Options for the GLSL preprocessor. */
export interface PreprocessOptions {
	/**
	 * Parameter definitions from the pack manifest.
	 * When provided, a `layout(set=1, binding=0) uniform Params { ... }` block
	 * is injected with one `vec4` field per parameter (matching the Cat Nip
	 * convention where every parameter occupies a full vec4 slot).
	 *
	 * The GLSL shader can then access parameters as e.g. `p.speed.x`,
	 * `p.tint.xyz`, etc.
	 */
	parameters?: ReadonlyArray<{ name: string }>;

	/**
	 * When true, inject prev-frame feedback bindings at @group(2):
	 *   layout(set=2, binding=0) uniform sampler prev_sampler;
	 *   layout(set=2, binding=1) uniform texture2D prev_tex;
	 *
	 * The GLSL shader samples the previous frame with:
	 *   texture(sampler2D(prev_tex, prev_sampler), uv)
	 *
	 * Detection: the loader auto-detects @group(2) usage in the transpiled
	 * WGSL, so this is only needed if the GLSL source wants to use prev-frame
	 * feedback. If the GLSL author declares these bindings manually, skip this.
	 */
	prevFrame?: boolean;

	/**
	 * When true, inject inter-pass input bindings at @group(3).
	 * Used for extra-pass shaders in multi-pass chains (e.g., bloom post-FX).
	 *   layout(set=3, binding=0) uniform sampler pass_sampler;
	 *   layout(set=3, binding=1) uniform texture2D pass_tex;
	 */
	interPass?: boolean;
}

/**
 * Preprocess a GLSL fragment shader into Naga-compatible GLSL 450.
 *
 * Accepts either:
 *   - Raw Shadertoy convention (void mainImage)
 *   - Already-structured GLSL 450 with void main()
 *   - Cat Nip-extended GLSL using audio uniforms directly
 */
export function preprocessGlsl(source: string, options?: PreprocessOptions): PreprocessResult {
	if (!source.trim()) {
		return { ok: false, error: "empty shader source" };
	}

	const lines: string[] = [];
	let src = source;

	// 1. Version directive
	if (!VERSION_RE.test(src)) {
		lines.push("#version 450");
	}

	// 2. Uniform block (skip if user already declared one)
	if (!HAS_UNIFORM_BLOCK_RE.test(src)) {
		lines.push(UNIFORM_BLOCK);
	}

	// 3. Parameter block (inject if manifest declares parameters and shader
	//    doesn't already have a set=1 binding)
	const params = options?.parameters;
	if (params && params.length > 0 && !HAS_PARAM_BLOCK_RE.test(src)) {
		lines.push(buildParamBlock(params));
	}

	// 4. Prev-frame feedback bindings (set=2)
	// Auto-detect: inject if the shader uses prev_tex/prev_sampler but hasn't
	// declared set=2 bindings. Also inject if explicitly requested via options.
	const usesPrevFrame = options?.prevFrame || /\bprev_tex\b/.test(src) || /\bprev_sampler\b/.test(src);
	if (usesPrevFrame && !HAS_PREV_FRAME_RE.test(src)) {
		lines.push(`
// Previous frame feedback (auto-injected)
layout(set=2, binding=0) uniform sampler prev_sampler;
layout(set=2, binding=1) uniform texture2D prev_tex;
`);
	}

	// 5. Inter-pass input bindings (set=3) — for extra-pass shaders in multi-pass chains
	// Auto-detect: inject if the shader uses pass_tex/pass_sampler but hasn't
	// declared set=3 bindings. Also inject if explicitly requested via options.
	const usesInterPass = options?.interPass || /\bpass_tex\b/.test(src) || /\bpass_sampler\b/.test(src);
	if (usesInterPass && !HAS_INTER_PASS_RE.test(src)) {
		lines.push(`
// Inter-pass input (auto-injected)
layout(set=3, binding=0) uniform sampler pass_sampler;
layout(set=3, binding=1) uniform texture2D pass_tex;
`);
	}

	// 6. Strip precision qualifiers (valid in GLSL ES, invalid in GLSL 450).
	// Common in Shadertoy shaders: `precision mediump float;`, `precision highp int;`, etc.
	src = src.replace(/^([ \t]*)(precision\s+(?:lowp|mediump|highp)\s+\w+\s*;)/gm, "$1// [stripped precision] $2");

	// 7. Shadertoy aliases (always inject -- they're #defines so duplicates are harmless
	//    unless the user already defined them, which we strip below)
	src = stripExistingDefines(src, [
		"iTime", "iGlobalTime", "iResolution", "iTimeDelta", "iFrame",
		"iMouse", "iDate", "iSampleRate", "iChannelResolution", "iChannelTime",
	]);
	lines.push(SHADERTOY_ALIASES);

	// 8. Rewrite texture2D() → texture() (GLSL 1.x → 4.5 compat)
	// Must happen before iChannel stubbing since we want to catch both forms.
	src = src.replace(/\btexture2D\s*\(/g, "texture(");

	// 9. Stub iChannel0-3 texture lookups → vec4(0.0).
	// Shadertoy shaders use texture(iChannel0, uv) for texture inputs.
	// Cat Nip has no texture channel system, so we replace these calls with
	// black pixels. This lets the shader compile and render (minus textures).
	src = stubIChannelTextureCalls(src);

	// 9b. If iChannel references remain (e.g., passed to user functions as sampler2D
	// parameters), apply the more aggressive sampler2D function rewrite. This replaces
	// `sampler2D` params with `int`, stubs texture calls inside those functions, and
	// replaces `iChannelN` call-site args with `0`.
	if (/\biChannel[0-3]\b/.test(src)) {
		src = stubSampler2DFunctions(src);
		// Replace any remaining bare iChannel references with 0
		src = src.replace(/\biChannel[0-3]\b/g, "0");
	}

	// Also stub bare iChannelResolution references
	if (/\biChannelResolution\b/.test(src)) {
		src = src.replace(/\biChannelResolution\s*\[\s*\d+\s*\]/g, "vec3(resolution, 1.0)");
	}

	// Also stub bare iChannelTime references
	if (/\biChannelTime\b/.test(src)) {
		src = src.replace(/\biChannelTime\s*\[\s*\d+\s*\]/g, "(time_ms / 1000.0)");
	}

	// 10. Apply mat2 fixups
	src = fixMat2Scalars(src);

	// 11. Append user source
	lines.push(src);

	// 12. Entry-point wrapper
	const hadMainImage = MAIN_IMAGE_RE.test(src);
	if (hadMainImage) {
		lines.push(ENTRY_WRAPPER);
	} else if (!hasVoidMain(src)) {
		return {
			ok: false,
			error:
				"shader must define either `void mainImage(out vec4, vec2)` (Shadertoy convention) or `void main()`",
		};
	} else {
		// User has void main() already -- ensure output variable is declared
		if (!hasLayoutOut(src)) {
			// Insert layout output before the user code (after our preamble)
			// Find the index where user source starts and prepend
			const insertIdx = lines.length - 1; // before user source
			lines.splice(insertIdx, 0, "layout(location=0) out vec4 _fragColor;");
		}
	}

	return { ok: true, glsl: lines.join("\n"), hadMainImage };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a GLSL uniform block for pack parameters.
 * Each parameter gets one vec4 slot (matching Cat Nip's WGSL convention).
 */
function buildParamBlock(params: ReadonlyArray<{ name: string }>): string {
	const fields = params.map((p) => `  vec4 ${p.name};`).join("\n");
	return `
// Pack parameters (auto-injected from manifest)
layout(set=1, binding=0) uniform Params {
${fields}
};
`;
}

/** Check if the source contains `void main()` or `void main(void)`. */
function hasVoidMain(src: string): boolean {
	return /void\s+main\s*\(\s*(void)?\s*\)/.test(src);
}

/** Check if the source already has a `layout(location=N) out vec4` declaration. */
function hasLayoutOut(src: string): boolean {
	return /layout\s*\(\s*location\s*=\s*\d+\s*\)\s*out\s+vec4/.test(src);
}

/**
 * Strip existing #define directives for names we're about to redefine.
 * Prevents Naga's "DefineRedefined" error.
 */
function stripExistingDefines(src: string, names: string[]): string {
	for (const name of names) {
		const re = new RegExp(`^\\s*#define\\s+${name}\\b[^\\n]*$`, "gm");
		src = src.replace(re, "// [stripped duplicate] $&");
	}
	return src;
}

/**
 * Replace texture/texelFetch calls that reference iChannel0..3 with vec4(0.0).
 *
 * Shadertoy provides up to 4 texture channels (iChannel0-iChannel3) that can
 * be bound to images, cubemaps, video, audio, etc.  Cat Nip has no texture
 * channel system, so we stub these lookups at the source level.
 *
 * Patterns handled:
 *   texture(iChannel0, uv)              → vec4(0.0)
 *   texture(iChannel0, uv, bias)        → vec4(0.0)
 *   texelFetch(iChannel0, ivec2(...), 0)→ vec4(0.0)
 *   textureLod(iChannel0, uv, lod)      → vec4(0.0)
 *
 * Uses balanced-paren parsing so nested expressions in the UV argument are
 * handled correctly.
 */
function stubIChannelTextureCalls(src: string): string {
	// Match texture/texelFetch/textureLod/textureGrad calls with iChannel argument
	const TEX_CALL_RE = /\b(texture|texelFetch|textureLod|textureGrad)\s*\(/g;
	let result = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = TEX_CALL_RE.exec(src)) !== null) {
		const openIdx = match.index + match[0].length; // index after '('
		const args = splitBalancedArgs(src, openIdx);
		if (args === null) continue; // unbalanced — leave as-is

		// Check if the first argument is an iChannel reference
		const firstArg = args.parts[0].trim();
		if (/^iChannel[0-3]$/.test(firstArg)) {
			// Replace the entire texture call with vec4(0.0)
			result += src.slice(lastIndex, match.index);
			result += "vec4(0.0)";
			lastIndex = args.closeIdx + 1;
		}
	}

	result += src.slice(lastIndex);
	return result;
}

/**
 * Rewrite functions that accept `sampler2D` parameters so they compile in
 * Naga's GLSL 450 (which doesn't support opaque types as function params).
 *
 * Strategy:
 *   1. Find function definitions with `sampler2D paramName` in the parameter list.
 *   2. For each such function, collect the sampler param names.
 *   3. Replace `sampler2D paramName` → `int paramName` in the signature.
 *   4. Inside the function body, replace `texture(paramName, ...)` → `vec4(0.0)`.
 *   5. At call sites, `iChannelN` args will be replaced with `0` by the caller.
 *
 * This is specifically for Shadertoy compatibility where `sampler2D` params
 * are used to pass `iChannel` textures to helper functions. Since we have no
 * texture channel system, the stubbed functions return black for all lookups.
 */
function stubSampler2DFunctions(src: string): string {
	// Match function definitions with sampler2D params.
	// Pattern: `returnType funcName(... sampler2D paramName ...)`
	// We need to find the function signature and body.

	// Step 1: Replace sampler2D params in function signatures and collect param names
	const SAMPLER_PARAM_RE = /\bsampler2D\s+(\w+)/g;
	const samplerParamNames: string[] = [];

	// Collect all sampler2D parameter names
	let paramMatch: RegExpExecArray | null;
	const tempRe = /\bsampler2D\s+(\w+)/g;
	while ((paramMatch = tempRe.exec(src)) !== null) {
		samplerParamNames.push(paramMatch[1]);
	}

	if (samplerParamNames.length === 0) return src;

	// Replace sampler2D type with int in signatures
	src = src.replace(SAMPLER_PARAM_RE, "int $1");

	// Step 2: For each collected param name, replace texture calls that use it
	for (const paramName of samplerParamNames) {
		// Replace texture(paramName, ...) → vec4(0.0)
		// Also handle texelFetch, textureLod, textureGrad
		const texCallRe = new RegExp(`\\b(texture|texelFetch|textureLod|textureGrad)\\s*\\(`, "g");
		let result = "";
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = texCallRe.exec(src)) !== null) {
			const openIdx = match.index + match[0].length;
			const args = splitBalancedArgs(src, openIdx);
			if (args === null) continue;

			const firstArg = args.parts[0].trim();
			if (firstArg === paramName) {
				result += src.slice(lastIndex, match.index);
				result += "vec4(0.0)";
				lastIndex = args.closeIdx + 1;
			}
		}

		result += src.slice(lastIndex);
		src = result;
	}

	return src;
}

/**
 * Helper function injected when we rewrite mat2(vec4_expr).
 * Naga rejects mat2(vec4) but accepts mat2(vec2, vec2).
 */
const MAT2_VEC4_HELPER = `
// Naga compat: mat2 from vec4 (auto-injected)
mat2 _mat2v4(vec4 v) { return mat2(v.xy, v.zw); }
`;

/** Matches a simple numeric literal (int or float), possibly negative. */
const SIMPLE_NUMERIC_RE = /^-?\s*\d+(\.\d*)?(e[+-]?\d+)?f?\s*$/i;

/**
 * Rewrite mat2 constructions that Naga rejects:
 *   1. mat2(a, b, c, d) → mat2(vec2(a, b), vec2(c, d))  [4 scalar args]
 *   2. mat2(vec4_expr)  → _mat2v4(vec4_expr)             [1 non-scalar arg]
 *
 * Case 1: Only applied when the arguments don't look like vec2() already.
 * Case 2: Only applied when the single argument is not a simple numeric
 *         literal (which would be the valid mat2(float) diagonal form).
 *
 * Uses balanced-parenthesis aware argument splitting so that
 * `mat2(cos(t), sin(t), -sin(t), cos(t))` is handled correctly.
 */
function fixMat2Scalars(src: string): string {
	// Find all `mat2(` occurrences and try to parse their arguments
	const MAT2_START = /mat2\s*\(/g;
	let result = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	let needsHelper = false;

	while ((match = MAT2_START.exec(src)) !== null) {
		const openIdx = match.index + match[0].length; // index after the '('
		const args = splitBalancedArgs(src, openIdx);
		if (args === null) continue; // unbalanced -- leave as-is

		if (args.parts.length === 4) {
			// Case 1: mat2(a, b, c, d) → mat2(vec2(a, b), vec2(c, d))
			const [a, b, c, d] = args.parts.map((s) => s.trim());

			// Don't transform if args already look like vec2()
			if (a.startsWith("vec2") || c.startsWith("vec2")) {
				continue;
			}

			result += src.slice(lastIndex, match.index);
			result += `mat2(vec2(${a}, ${b}), vec2(${c}, ${d}))`;
			lastIndex = args.closeIdx + 1;
		} else if (args.parts.length === 1) {
			// Case 2: mat2(expr) — could be mat2(float) or mat2(vec4)
			const arg = args.parts[0].trim();

			// mat2(float_literal) is a valid diagonal matrix — leave it alone
			if (SIMPLE_NUMERIC_RE.test(arg)) continue;

			// Single complex expression — likely a vec4. Rewrite to helper.
			result += src.slice(lastIndex, match.index);
			result += `_mat2v4(${arg})`;
			lastIndex = args.closeIdx + 1;
			needsHelper = true;
		}
		// 2-arg case (already vec2, vec2) and other counts: leave as-is
	}

	result += src.slice(lastIndex);

	// Inject the helper function at the top if we rewrote any mat2(vec4) calls
	if (needsHelper) {
		result = MAT2_VEC4_HELPER + result;
	}

	return result;
}

/**
 * Split comma-separated arguments starting at `startIdx` (just after the
 * opening paren), respecting nested parentheses. Returns the argument
 * strings and the index of the closing ')'.
 */
function splitBalancedArgs(
	src: string,
	startIdx: number,
): { parts: string[]; closeIdx: number } | null {
	let depth = 1;
	let i = startIdx;
	const argStarts: number[] = [startIdx];

	while (i < src.length && depth > 0) {
		const ch = src[i];
		if (ch === "(") depth++;
		else if (ch === ")") {
			depth--;
			if (depth === 0) break;
		} else if (ch === "," && depth === 1) {
			argStarts.push(i + 1);
		}
		i++;
	}

	if (depth !== 0) return null; // unbalanced

	const closeIdx = i;
	const parts: string[] = [];
	for (let j = 0; j < argStarts.length; j++) {
		const end = j + 1 < argStarts.length ? argStarts[j + 1] - 1 : closeIdx;
		parts.push(src.slice(argStarts[j], end));
	}

	return { parts, closeIdx };
}
