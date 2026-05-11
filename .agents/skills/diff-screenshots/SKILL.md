---
name: diff-screenshots
description: Compare two PNG screenshots pixel-by-pixel and report difference metrics. Use when you need to verify that a shader change actually produced different output, compare parameter variations, or detect regressions.
---

# Diff Screenshots — Programmatic PNG Comparison

Use this skill to **programmatically compare two PNG images** and get quantitative difference metrics. This closes the feedback loop that screenshot-debug opens: you render two PNGs and then diff them to verify your change actually produced different (or identical) output.

This script does NOT need GPU access — it uses `pixelmatch` (perceptual comparison with anti-aliasing detection) and `pngjs` for decoding.

## Quick Reference

```
bun packages/app/scripts/diff-png.ts <a.png> <b.png> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--threshold <n>` | Perceptual matching threshold (0-1). Lower = more sensitive. 0 = exact match. | `0.1` |
| `--out <path>` | Write a visual diff PNG showing changed pixels in red | — |
| `--json` | Output results as JSON | — |
| `--quiet` | Only print IDENTICAL/DIFFERENT | — |

| Exit code | Meaning |
|-----------|---------|
| 0 | Images are identical (within threshold) |
| 1 | Images differ |
| 2 | Usage error (missing files, dimension mismatch, etc.) |

## Output Metrics

The script reports these metrics:

| Metric | Description |
|--------|-------------|
| **changedPixels** | Number of pixels that differ (above threshold) |
| **changedPercent** | Percentage of total pixels that differ |

## Threshold Guide

The `--threshold` option controls pixelmatch's perceptual color distance. Some useful values:

| Value | Behavior |
|-------|----------|
| `0` | Exact byte-for-byte match only |
| `0.05` | Very sensitive — catches subtle tonal shifts |
| `0.1` | Default — good balance for shader comparison |
| `0.2` | Tolerant — ignores minor color variations |
| `0.5` | Very tolerant — only detects major changes |

## Common Workflows

### Verify a shader change produced different output

The most common use case: you edited a shader and want to confirm it looks different.

```bash
# Render before the change
bun packages/app/scripts/render-pack-debug.ts my-pack --out /tmp/before.png

# ... make shader edits ...

# Render after the change
bun packages/app/scripts/render-pack-debug.ts my-pack --out /tmp/after.png

# Compare
bun packages/app/scripts/diff-png.ts /tmp/before.png /tmp/after.png
```

Expected output for a meaningful change:
```
[diff-png] changed pixels: 245760 (100.00%)
[diff-png] DIFFERENT
```

If you see `IDENTICAL`, your change didn't affect the visual output.

### Compare parameter variations

Render the same pack with different parameter values and verify they produce different output:

```bash
bun packages/app/scripts/render-pack-debug.ts bloom-pulse --param rings=4  --out /tmp/rings4.png
bun packages/app/scripts/render-pack-debug.ts bloom-pulse --param rings=24 --out /tmp/rings24.png
bun packages/app/scripts/diff-png.ts /tmp/rings4.png /tmp/rings24.png
```

### Compare presets

```bash
bun packages/app/scripts/render-pack-debug.ts bloom-pulse --preset Soft    --out /tmp/soft.png
bun packages/app/scripts/render-pack-debug.ts bloom-pulse --preset Inferno --out /tmp/inferno.png
bun packages/app/scripts/diff-png.ts /tmp/soft.png /tmp/inferno.png
```

### Verify audio reactivity

Render with different audio overrides and confirm the shader responds:

```bash
bun packages/app/scripts/render-pack-debug.ts my-pack --audio bass=0   --out /tmp/no-bass.png
bun packages/app/scripts/render-pack-debug.ts my-pack --audio bass=1.0 --out /tmp/full-bass.png
bun packages/app/scripts/diff-png.ts /tmp/no-bass.png /tmp/full-bass.png
```

If the result is `IDENTICAL`, the shader isn't using the `bass` audio feature.

### Check temporal evolution

Capture a pack at regular intervals and diff sequential frames to verify animation works:

```bash
# Capture every 0.5s over 3 seconds
bun packages/app/scripts/render-pack-debug.ts my-pack --capture-every 0.5 --time 3.0 --out /tmp/temporal.png --width 320 --height 240

# Diff frame at t=0s vs t=1s
bun packages/app/scripts/diff-png.ts /tmp/temporal_t0.0s.png /tmp/temporal_t1.0s.png

# Diff sequential frames to check smooth animation
bun packages/app/scripts/diff-png.ts /tmp/temporal_t0.0s.png /tmp/temporal_t0.5s.png
bun packages/app/scripts/diff-png.ts /tmp/temporal_t0.5s.png /tmp/temporal_t1.0s.png
```

If sequential frames are `IDENTICAL`, the shader isn't animating during that interval. If `changedPercent` is very high (>90%) between adjacent 0.5s frames, the animation may be too abrupt.

### Generate a visual diff image

Use `--out` to write a diff visualization where changed pixels are red and unchanged pixels are dimmed:

```bash
bun packages/app/scripts/diff-png.ts /tmp/before.png /tmp/after.png --out /tmp/diff.png
open /tmp/diff.png  # macOS
```

### Exact match check

Use `--threshold 0` for byte-exact comparison (e.g., verifying deterministic rendering):

```bash
bun packages/app/scripts/diff-png.ts /tmp/run1.png /tmp/run2.png --threshold 0
```

### JSON output for scripting

```bash
result=$(bun packages/app/scripts/diff-png.ts /tmp/a.png /tmp/b.png --json)
echo $result
```

Returns:
```json
{
  "identical": false,
  "dimensions": "640x480",
  "totalPixels": 307200,
  "changedPixels": 245760,
  "changedPercent": 80.0,
  "threshold": 0.1
}
```

### Full write-check-render-diff loop

The complete feedback cycle for shader development:

```bash
# 1. Check shader compiles
bun packages/app/scripts/check-shader.ts my-pack

# 2. Render baseline
bun packages/app/scripts/render-pack-debug.ts my-pack --out /tmp/before.png --width 320 --height 240

# ... make changes ...

# 3. Check shader still compiles
bun packages/app/scripts/check-shader.ts my-pack

# 4. Render after change
bun packages/app/scripts/render-pack-debug.ts my-pack --out /tmp/after.png --width 320 --height 240

# 5. Compare
bun packages/app/scripts/diff-png.ts /tmp/before.png /tmp/after.png --out /tmp/diff.png
```

## Interpreting Results

### "IDENTICAL" when you expected a change

- The shader might not use the parameter/feature you changed
- The change might only be visible at certain time points — try `--time 3.0` instead of the default 2s
- The parameter might be clamped to its previous value by the manifest's min/max range
- Try `--threshold 0` for exact comparison (default 0.1 may treat near-identical colors as matching)

### Very low `changedPercent` (<1%)

- The change is likely only affecting a small region (e.g., one element in a shader that draws many)
- Use `--out` to generate a diff image and see where the differences are

### Both images are completely different (100% changed)

- Expected when comparing different packs or radically different parameter sets
- Also happens when comparing different time points for animated shaders

## Limitations

- Dimensions must match — use the same `--width` and `--height` for both renders
- The diff image shows changed pixels in red (pixelmatch default) with unchanged pixels dimmed

## Key Files

| File | Role |
|------|------|
| `packages/app/scripts/diff-png.ts` | The comparison script (uses pixelmatch + pngjs) |
| `packages/app/scripts/render-pack-debug.ts` | Renders PNGs to compare |
