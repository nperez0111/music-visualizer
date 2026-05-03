import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { computePackHashFromDir } from "../bun/packs/hash";
import { validateManifest } from "../bun/packs/loader";

const PACKS_DIR = resolve(import.meta.dir);

// WGSL reserved + keyword list. Taken from the WGSL spec (§2.3) and naga's
// implementation. Field names in `struct Params` must not collide with these,
// or naga rejects pipeline creation with `'<word>' is a reserved keyword`.
//
// We hit this once: a manifest enum named `target` was carried verbatim into
// the WGSL `Params` struct, and the pipeline never built. The check below
// guards against repeating that.
const WGSL_RESERVED = new Set([
	// Keywords (WGSL §2.2)
	"alias", "break", "case", "const", "const_assert", "continue", "continuing",
	"default", "diagnostic", "discard", "else", "enable", "false", "fn", "for",
	"if", "let", "loop", "override", "requires", "return", "struct", "switch",
	"true", "var", "while",
	// Reserved words (WGSL §2.3)
	"abstract", "as", "async", "attribute", "await", "become", "bf16",
	"binding_array", "cast", "catch", "class", "co_await", "co_return",
	"co_yield", "coherent", "column_major", "common", "compile",
	"compile_fragment", "concept", "const_cast", "consteval", "constexpr",
	"constinit", "crate", "debugger", "delete", "demote", "demote_to_helper",
	"do", "dynamic_cast", "enum", "explicit", "export", "extends", "extern",
	"external", "fallthrough", "filter", "final", "finally", "friend", "from",
	"fxgroup", "get", "goto", "groupshared", "highp", "impl", "implements",
	"import", "inline", "instanceof", "interface", "layout", "lowp", "macro",
	"macro_rules", "match", "mediump", "meta", "mod", "module", "move", "mut",
	"mutable", "namespace", "new", "nil", "noexcept", "noinline",
	"nointerpolation", "noperspective", "null", "nullptr", "of", "operator",
	"package", "packoffset", "partition", "pass", "patch", "pixelfragment",
	"precise", "precision", "premerge", "priv", "protected", "pub", "public",
	"readonly", "ref", "regardless", "register", "reinterpret_cast", "require",
	"resource", "restrict", "self", "set", "shared", "sizeof", "smooth",
	"snorm", "static", "static_assert", "static_cast", "std", "subroutine",
	"super", "target", "template", "this", "thread_local", "throw", "trait",
	"try", "type", "typedef", "typeid", "typename", "typeof", "union",
	"unless", "unorm", "unsafe", "unsized", "use", "using", "varying",
	"virtual", "volatile", "wgsl", "where", "with", "writeonly", "yield",
]);

function listPackDirs(): string[] {
	return readdirSync(PACKS_DIR)
		.filter((name) => {
			const full = join(PACKS_DIR, name);
			if (!statSync(full).isDirectory()) return false;
			return existsSync(join(full, "manifest.json"));
		})
		.sort();
}

/** Strip line + block comments so regex checks don't false-positive on commented-out code. */
function stripComments(wgsl: string): string {
	return wgsl
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
}

/** Pull the field names from `struct Params { ... };`. Returns null if the struct isn't found. */
function extractParamsFieldNames(wgsl: string): string[] | null {
	const stripped = stripComments(wgsl);
	const m = /struct\s+Params\s*\{([^}]*)\}/m.exec(stripped);
	if (!m) return null;
	const body = m[1]!;
	const fields: string[] = [];
	// Each field is `name : type ,?`. We only need the name + the literal `vec4<f32>` type.
	const fieldRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*vec4\s*<\s*f32\s*>/g;
	let f: RegExpExecArray | null;
	while ((f = fieldRe.exec(body))) fields.push(f[1]!);
	return fields;
}

const packDirs = listPackDirs();

describe("packs (static checks)", () => {
	test("found at least one pack", () => {
		expect(packDirs.length).toBeGreaterThan(0);
	});

	for (const dir of packDirs) {
		describe(dir, () => {
			const packPath = join(PACKS_DIR, dir);
			const manifestPath = join(packPath, "manifest.json");

			let raw: unknown;
			let manifestText = "";
			try {
				manifestText = readFileSync(manifestPath, "utf8");
				raw = JSON.parse(manifestText);
			} catch (err) {
				test("manifest.json parses as JSON", () => {
					throw new Error(`failed to read/parse ${manifestPath}: ${err}`);
				});
				return;
			}

			const validation = validateManifest(raw);

			test("manifest validates", () => {
				if (!validation.ok) throw new Error(validation.err);
			});

			if (!validation.ok) return;
			const m = validation.m;

			test("pack content hash is a 64-char lowercase hex sha256", () => {
				const id = computePackHashFromDir(packPath);
				expect(id).toMatch(/^[0-9a-f]{64}$/);
			});

			test("main shader file exists", () => {
				expect(existsSync(join(packPath, m.shader))).toBe(true);
			});

			for (const pass of m.passes ?? []) {
				test(`pass shader exists: ${pass.shader}`, () => {
					expect(existsSync(join(packPath, pass.shader))).toBe(true);
				});
			}

			if (m.wasm) {
				test(`wasm file exists: ${m.wasm}`, () => {
					expect(existsSync(join(packPath, m.wasm!))).toBe(true);
				});
			}

			if (existsSync(join(packPath, "pack.wasm"))) {
				test("pack.wasm has a sibling pack.ts (source kept in repo)", () => {
					expect(existsSync(join(packPath, "pack.ts"))).toBe(true);
				});
			}

			// --- Main shader contract checks ---
			let mainShader = "";
			try {
				mainShader = readFileSync(join(packPath, m.shader), "utf8");
			} catch {}

			const hasParams = (m.parameters?.length ?? 0) > 0;
			const mainStripped = stripComments(mainShader);
			const mainHasGroup1 = /@group\s*\(\s*1\s*\)/.test(mainStripped);

			test("@group(1) binding presence matches manifest parameters", () => {
				if (hasParams) {
					expect(mainHasGroup1).toBe(true);
				} else {
					// Pack with no parameters — shader must not bind group 1, since the
					// host wouldn't allocate a parameter buffer.
					expect(mainHasGroup1).toBe(false);
				}
			});

			if (hasParams) {
				const fields = extractParamsFieldNames(mainShader);

				test("declares `struct Params` with vec4<f32> fields", () => {
					expect(fields).not.toBeNull();
					expect(fields!.length).toBeGreaterThan(0);
				});

				if (fields) {
					test("Params field count matches manifest parameter count", () => {
						expect(fields.length).toBe(m.parameters!.length);
					});

					test("no Params field name is a WGSL reserved word", () => {
						const offenders = fields.filter((n) => WGSL_RESERVED.has(n));
						expect(offenders).toEqual([]);
					});
				}
			}

			// --- Extra pass shader contract checks ---
			for (const pass of m.passes ?? []) {
				const passPath = join(packPath, pass.shader);
				if (!existsSync(passPath)) continue;
				const passShader = readFileSync(passPath, "utf8");
				const passStripped = stripComments(passShader);

				if (hasParams) {
					test(`${pass.shader}: declares @group(1) (pack has parameters)`, () => {
						expect(/@group\s*\(\s*1\s*\)/.test(passStripped)).toBe(true);
					});
				}

				test(`${pass.shader}: declares @group(3) input binding`, () => {
					expect(/@group\s*\(\s*3\s*\)/.test(passStripped)).toBe(true);
				});
			}
		});
	}
});
