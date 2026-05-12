/**
 * GLSL → WGSL transpiler orchestrator.
 *
 * Pipeline:  raw GLSL  →  preprocessGlsl()  →  Naga CLI  →  post-process  →  WGSL
 *
 * The transpiler is synchronous (uses spawnSync) to fit into the existing
 * synchronous pack-loading pipeline.
 */

import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { preprocessGlsl, type PreprocessResult, type PreprocessOptions } from "./glsl-preprocess";
import { findNagaBinary } from "../paths";

// ---------------------------------------------------------------------------
// The standard fullscreen-triangle vertex shader, identical to what every
// native WGSL pack uses. Prepended to the transpiled fragment output.
// ---------------------------------------------------------------------------

const FULLSCREEN_VERTEX_SHADER = `
// Fullscreen triangle vertex shader (auto-generated)
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, -y, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type TranspileResult =
	| { ok: true; wgsl: string }
	| { ok: false; error: string; stage: "preprocess" | "naga" | "postprocess" };

/** Options forwarded to the GLSL preprocessor. */
export type TranspileOptions = PreprocessOptions;

/**
 * Transpile a GLSL fragment shader to Cat Nip-compatible WGSL.
 *
 * Synchronous: uses spawnSync for Naga CLI invocation.
 * The temporary files are cleaned up regardless of success/failure.
 */
export function transpileGlslToWgsl(glslSource: string, options?: TranspileOptions): TranspileResult {
	// Step 1: Preprocess
	const pp: PreprocessResult = preprocessGlsl(glslSource, options);
	if (!pp.ok) {
		return { ok: false, error: pp.error, stage: "preprocess" };
	}

	// Step 2: Find naga binary
	const nagaBin = findNagaBinary();
	if (!nagaBin) {
		return {
			ok: false,
			error:
				"naga-cli not found. Install with: cargo install naga-cli",
			stage: "naga",
		};
	}

	// Step 3: Write preprocessed GLSL to temp file, invoke Naga
	const tmpDir = mkdtempSync(join(tmpdir(), "catnip-glsl-"));
	const inputPath = join(tmpDir, "input.frag.glsl");
	const outputPath = join(tmpDir, "output.wgsl");

	try {
		writeFileSync(inputPath, pp.glsl, "utf8");

		const result = spawnSync(nagaBin, [inputPath, outputPath], {
			timeout: 10_000,
			encoding: "utf8",
		});

		if (result.status !== 0) {
			const stderr = (result.stderr || "").trim();
			const stdout = (result.stdout || "").trim();
			const msg = stderr || stdout || `naga exited with code ${result.status}`;
			return { ok: false, error: `naga transpilation failed:\n${msg}`, stage: "naga" };
		}

		if (result.error) {
			return {
				ok: false,
				error: `naga process error: ${result.error.message}`,
				stage: "naga",
			};
		}

		const rawWgsl = readFileSync(outputPath, "utf8");

		// Step 4: Post-process
		const wgsl = postProcessWgsl(rawWgsl);

		return { ok: true, wgsl };
	} finally {
		// Always clean up temp files
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
}

// ---------------------------------------------------------------------------
// Post-processing: rename Naga's output to match Cat Nip conventions
// ---------------------------------------------------------------------------

/**
 * Post-process Naga's WGSL output:
 *   1. Rename the fragment entry point from `fn main(` → `fn fs_main(`
 *   2. Prepend the fullscreen-triangle vertex shader
 *   3. Rename the uniform variable from `global` to `u` (Cat Nip convention)
 *   4. Rename the params variable from `global_1` to `p` (Cat Nip convention)
 */
function postProcessWgsl(raw: string): string {
	let wgsl = raw;

	// Naga emits:
	//   @fragment fn main(...) -> FragmentOutput { ... }
	//   fn main_1() { ... }  (the inner implementation)
	//
	// We rename the @fragment entry point to fs_main.
	// The inner main_1 is fine as-is (it's not an entry point).
	wgsl = wgsl.replace(
		/(@fragment\s*\nfn\s+)main(\s*\()/,
		"$1fs_main$2",
	);

	// Also handle single-line @fragment fn main(
	wgsl = wgsl.replace(
		/(@fragment\s+fn\s+)main(\s*\()/,
		"$1fs_main$2",
	);

	// Rename Naga's `global_1` params variable to `_cn_p` (collision-safe).
	// Naga outputs: `var<uniform> global_1: Params;`
	// We use `_cn_p` instead of bare `p` because Shadertoy shaders commonly
	// declare a local `vec3 p` (e.g., ray position), which would shadow a
	// module-level `p` and break parameter access.
	// Order matters: must do global_1 before global to avoid partial matches.
	wgsl = wgsl.replace(
		/var<uniform>\s+global_1\s*:\s*Params/,
		"var<uniform> _cn_p: Params",
	);
	wgsl = wgsl.replace(/\bglobal_1\./g, "_cn_p.");

	// Rename Naga's `global` uniform variable to `_cn_u` (collision-safe).
	// Naga outputs: `var<uniform> global: Uniforms;`
	// We use `_cn_u` instead of bare `u` because Shadertoy shaders commonly
	// declare a local `vec2 u`, which would shadow a module-level `u` and
	// break uniform access (e.g. `u.resolution` resolving to the local vec2).
	// The GPU pipeline binds by @group(0)/@binding(0), not by variable name.
	wgsl = wgsl.replace(
		/var<uniform>\s+global\s*:\s*Uniforms/,
		"var<uniform> _cn_u: Uniforms",
	);
	// Also replace all references to `global.` with `_cn_u.`
	wgsl = wgsl.replace(/\bglobal\./g, "_cn_u.");

	// Prepend vertex shader
	wgsl = FULLSCREEN_VERTEX_SHADER + "\n" + wgsl;

	return wgsl;
}
