---
name: shader-check
description: Validate WGSL shader compilation without a full headless render. Use when writing or editing a pack shader and you want fast feedback on syntax/compilation errors before doing a visual render.
---

# Shader Check — Fast WGSL Compilation Validation

Use this skill to **quickly validate that a WGSL shader compiles** without rendering any frames. This is the fastest feedback loop for catching syntax errors, type mismatches, binding mismatches, and other compilation failures during pack development.

Typical timing: ~100ms (vs ~300ms+ for a full headless render).

## Prerequisites

Same as screenshot-debug — needs a bundled bun from an electrobun build:

```bash
# macOS
bunx electrobun dev

# Linux
bunx electrobun build --env=canary
```

## Quick Reference

```
bun packages/app/scripts/check-shader.ts <slug>              # check a built-in pack
bun packages/app/scripts/check-shader.ts --file <path.wgsl>  # check a raw WGSL file
bun packages/app/scripts/check-shader.ts --list-packs         # list available packs
```

| Exit code | Meaning |
|-----------|---------|
| 0 | Shader compiles successfully |
| 1 | Shader compilation or pipeline creation failed |
| 2 | Usage error (bad args, missing files, no bundle) |

## What It Checks

1. **Shader module creation** — wgpu compiles the WGSL source. Catches syntax errors, undefined variables, type mismatches, missing entry points (`vs_main`, `fs_main`).
2. **Render pipeline creation** — wgpu links the shader module into a render pipeline. Catches mismatched vertex/fragment interfaces.
3. **Bind group compatibility** — the pipeline's bind group layouts are created:
   - `@group(0)` — uniform buffer (always present)
   - `@group(1)` — parameter buffer (only if pack declares parameters)
   - `@group(2)` — prev-frame sampler + texture (only if shader uses `@group(2)`)
   - `@group(3)` — inter-pass input (only for extra passes)
4. **Extra pass shaders** — all post-FX pass shaders in the manifest are compiled and linked.

## When to Use

### During pack development

After every shader edit, run the check before doing a full render:

```bash
# Edit the shader
vim packages/app/src/packs/my-pack/shader.wgsl

# Fast compile check (~100ms)
bun packages/app/scripts/check-shader.ts my-pack

# Only render if compilation passes
bun packages/app/scripts/render-pack-debug.ts my-pack
```

### Checking a standalone WGSL file

If you're writing a shader outside the pack system (e.g., a scratch file or a template):

```bash
bun packages/app/scripts/check-shader.ts --file /tmp/experiment.wgsl
```

Note: `--file` mode doesn't know about parameters, so `@group(1)` bindings won't be validated. It does detect `@group(2)` usage and creates a dummy prev-frame texture.

### In a write-check-render loop

The recommended workflow when creating or modifying a pack:

1. **Write** the shader code
2. **Check** with `bun packages/app/scripts/check-shader.ts <slug>` — fast, catches most errors
3. **Render** with `bun packages/app/scripts/render-pack-debug.ts <slug>` — only if step 2 passes
4. **Diff** with `bun packages/app/scripts/diff-png.ts` — compare before/after if modifying

This avoids wasting ~300ms on a full render cycle when the shader has a typo.

## Common Errors and Fixes

### "Failed to create shader module"

The WGSL source has a syntax error. Common causes:
- Missing semicolons
- Undeclared variables or functions
- Type mismatches (e.g., `vec3<f32>` vs `vec4<f32>`)
- Using `vs_main` / `fs_main` with wrong signatures

### "Failed to create render pipeline"

The shader compiled but the pipeline couldn't be built. Common causes:
- `vs_main` output struct doesn't match `fs_main` input struct
- Missing `@builtin(position)` in vertex output
- Incompatible blend state / color target format

### "pack declares parameters but shader has no @group(1) binding"

The pack manifest declares parameters but the shader doesn't have a `@group(1) @binding(0)` uniform. Either:
- Add the parameter struct to the shader
- Remove parameters from `manifest.json`

### "pack opts into prev-frame but shader has no @group(2) binding"

The shader source contains `@group(2)` references that the loader detected, but the actual compiled pipeline doesn't expose group 2. This usually means the `@group(2)` reference is in a comment or dead code.

## Key Files

| File | Role |
|------|------|
| `packages/app/scripts/check-shader.ts` | The CLI script |
| `packages/app/src/bun/gpu/pipeline.ts` | `createPackPipeline()` — what the check actually exercises |
| `packages/app/src/bun/gpu/renderer.ts` | `createHeadlessRenderer()` — boots wgpu without a window |
| `packages/app/src/bun/packs/loader.ts` | Pack manifest loading and validation |
