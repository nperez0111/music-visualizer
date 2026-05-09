import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "util";

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

const GLSL_TEMPLATE = `// Audio-reactive visualizer — Shadertoy convention
//
// Available uniforms:
//   iTime, iResolution, iTimeDelta (Shadertoy aliases)
//   bass, mid, treble, rms, peak, bpm, beat_phase, spectrum (Cat Nip audio)

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float t = iTime;

    float energy = bass * 0.5 + mid * 0.3 + treble * 0.2;
    float pulse = 0.8 + 0.2 * sin(beat_phase * 6.28318);

    float v = 0.0;
    v += sin(uv.x * 10.0 + t);
    v += sin(uv.y * 10.0 + t * 0.7);
    v += sin(length(uv - 0.5) * 10.0 * (1.0 + energy) - t * 0.9);
    v = v / 3.0 + 0.5;

    vec3 col;
    col.r = 0.5 + 0.5 * cos(6.28318 * (v + 0.0));
    col.g = 0.5 + 0.5 * cos(6.28318 * (v + 0.33));
    col.b = 0.5 + 0.5 * cos(6.28318 * (v + 0.67));

    fragColor = vec4(col * pulse, 1.0);
}
`;

const WGSL_TEMPLATE = `struct Uniforms {
  time_ms     : f32,
  delta_ms    : f32,
  resolution  : vec2<f32>,
  rms         : f32,
  peak        : f32,
  bass        : f32,
  mid         : f32,
  treble      : f32,
  bpm         : f32,
  beat_phase  : f32,
  _pad        : f32,
  spectrum    : array<vec4<f32>, 8>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let uv  = pix * 2.0 - vec2<f32>(1.0, 1.0);
  let t   = u.time_ms * 0.001;

  var color = vec3<f32>(
    0.5 + 0.5 * sin(t + uv.x * 6.0 + u.bass * 6.0),
    0.5 + 0.5 * sin(t * 1.3 + uv.y * 6.0 + u.mid * 6.0),
    0.5 + 0.5 * sin(t * 1.7 + length(uv) * 6.0 + u.treble * 6.0)
  );

  let pulse = pow(1.0 - u.beat_phase, 6.0) * 0.4;
  color = color + vec3<f32>(pulse);

  return vec4<f32>(color, 1.0);
}
`;

export async function run(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			lang: { type: "string", short: "l" },
			dir: { type: "string", short: "d" },
			author: { type: "string", short: "a" },
			description: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip create — Scaffold a new pack\n");
		console.log("Usage: catnip create <slug> [options]\n");
		console.log("Options:");
		console.log("  slug               Pack slug (lowercase, a-z, 0-9, hyphens)");
		console.log("  --lang, -l <lang>  Shader language: glsl (default) or wgsl");
		console.log("  --dir, -d <path>   Parent directory (default: current directory)");
		console.log("  --author, -a       Author name");
		console.log("  --description      Short description");
		return;
	}

	const slug = positionals[0];
	if (!slug) {
		throw new Error("Pack slug is required. Usage: catnip create <slug>");
	}
	if (!SLUG_RE.test(slug)) {
		throw new Error(
			`Invalid slug "${slug}". Must be lowercase, start with a letter, and contain only a-z, 0-9, and hyphens.`,
		);
	}

	const lang = (values.lang ?? "glsl").toLowerCase();
	if (lang !== "glsl" && lang !== "wgsl") {
		throw new Error(`Unknown language "${lang}". Use "glsl" or "wgsl".`);
	}

	const parentDir = resolve(values.dir ?? ".");
	const packDir = join(parentDir, slug);

	if (existsSync(packDir)) {
		throw new Error(`Directory already exists: ${packDir}`);
	}

	// Build manifest
	const name = slug
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");

	const manifest: Record<string, unknown> = {
		schemaVersion: 1,
		name,
		version: "0.1.0",
		shader: lang === "glsl" ? "shader.glsl" : "shader.wgsl",
	};

	if (values.author) manifest.author = values.author;
	if (values.description) manifest.description = values.description;
	if (lang === "glsl") manifest.tags = ["glsl"];

	manifest.audio = {
		features: ["bass", "mid", "treble", "beat_phase"],
	};

	// Write files
	mkdirSync(packDir, { recursive: true });
	writeFileSync(join(packDir, "manifest.json"), JSON.stringify(manifest, null, "  ") + "\n");
	writeFileSync(
		join(packDir, lang === "glsl" ? "shader.glsl" : "shader.wgsl"),
		lang === "glsl" ? GLSL_TEMPLATE : WGSL_TEMPLATE,
	);

	console.log(`Created pack: ${packDir}`);
	console.log(`  manifest.json`);
	console.log(`  shader.${lang}`);
	console.log(`\nNext steps:`);
	console.log(`  1. Edit the shader to create your visual`);
	console.log(`  2. catnip validate ${packDir}`);
	console.log(`  3. catnip build ${packDir}`);
}
