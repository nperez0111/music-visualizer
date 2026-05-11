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
 *   6. Adds Shadertoy compatibility aliases (#define iTime, iResolution, etc.)
 *   7. Wraps `mainImage(out vec4, in vec2)` into `void main()`
 *   8. Applies fixups for common Naga failure patterns
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
  mainImage(_fragColor, gl_FragCoord.xy);
}
`;

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches `void mainImage(out vec4 X, in vec2 Y)` with optional whitespace. */
const MAIN_IMAGE_RE = /void\s+mainImage\s*\(\s*out\s+vec4\s+\w+\s*,\s*in\s+vec2\s+\w+\s*\)/;

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

	// 6. Shadertoy aliases (always inject -- they're #defines so duplicates are harmless
	//    unless the user already defined them, which we strip below)
	src = stripExistingDefines(src, [
		"iTime", "iResolution", "iTimeDelta", "iFrame",
		"iMouse", "iDate", "iSampleRate",
	]);
	lines.push(SHADERTOY_ALIASES);

	// 7. Apply fixups before appending user code
	src = fixMat2Scalars(src);

	// 8. Append user source
	lines.push(src);

	// 9. Entry-point wrapper
	const hadMainImage = MAIN_IMAGE_RE.test(src);
	if (hadMainImage) {
		lines.push(ENTRY_WRAPPER);
	} else if (!hasVoidMain(src)) {
		return {
			ok: false,
			error:
				"shader must define either `void mainImage(out vec4, in vec2)` (Shadertoy convention) or `void main()`",
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
 * Rewrite mat2(a, b, c, d) → mat2(vec2(a, b), vec2(c, d))
 * Only applied when the arguments don't look like vec2() already.
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

	while ((match = MAT2_START.exec(src)) !== null) {
		const openIdx = match.index + match[0].length; // index after the '('
		const args = splitBalancedArgs(src, openIdx);
		if (args === null || args.parts.length !== 4) {
			// Not 4 args or unbalanced -- leave as-is
			continue;
		}

		const [a, b, c, d] = args.parts.map((s) => s.trim());

		// Don't transform if args already look like vec2()
		if (a.startsWith("vec2") || c.startsWith("vec2")) {
			continue;
		}

		// Replace this mat2(...) invocation
		result += src.slice(lastIndex, match.index);
		result += `mat2(vec2(${a}, ${b}), vec2(${c}, ${d}))`;
		lastIndex = args.closeIdx + 1; // skip past the closing ')'
	}

	result += src.slice(lastIndex);
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
