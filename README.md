# music-visualizer

A WinAMP-spirited desktop music visualizer for macOS, built on
[Electrobun](https://blackboard.sh/electrobun/) and WebGPU. It captures the
audio playing on your system (Spotify, browser, anything that makes sound)
and renders shader-based visuals that react in real time. Visualizers are
hot-swappable "packs" — drop in someone else's `.viz` file and use it
immediately.

> **Status:** macOS-only for now. The audio capture path is built on
> ScreenCaptureKit (macOS 13+). The render and pack systems are
> cross-platform; Linux/Windows audio is on the roadmap.

## Features

- **Captures system audio** with no virtual driver — uses
  ScreenCaptureKit's loopback. The first run prompts for Screen Recording
  permission (macOS gates audio behind it).
- **Hot-swappable visualizer packs.** Switch between bundled visualizers
  from a dropdown; transitions crossfade smoothly.
- **Two pack tiers:**
  - **Tier 1** — `manifest.json` + `shader.wgsl`. Pure WebGPU shaders.
  - **Tier 2** — adds a `pack.wasm` that computes per-frame uniforms in
    arbitrary code (any language that compiles to WASM).
- **Drag-and-drop installs.** A `.viz` file is just a zip with a manifest
  inside; click the **+** in the controls panel and pick one.
- **Native performance.** WebGPU runs out of the Bun main process via
  wgpu-native; no browser overhead in the render hot path.
- **Floating controls.** A tiny semi-transparent always-on-top panel sits
  over (or anywhere near) the visualizer. Drag it by the header,
  collapse to a pill with the **▾**.

## Quick start

```bash
bun install
bun run build:audiotap   # builds the Swift system-audio helper (one-time)
bun run build:packs      # compiles the AssemblyScript sample pack (one-time)
bun run dev
```

The first time the app starts, macOS will ask for **Screen Recording**
permission. Grant it — without it, system audio capture cannot start. The
visualizer falls back to synthesized features so you'll still see motion.

## Using it

- **Switch packs:** pick one from the **pack** dropdown. Crossfades over
  ~1.5 seconds.
- **Import a .viz:** click the **+** button next to the dropdown. Pick a
  `.viz` file. It's extracted into `~/Library/Application Support/music-visualizer.electrobun.dev/packs/<id>/`
  and added to the dropdown.
- **Drag the panel:** click and hold anywhere on the panel header.
- **Collapse the panel:** click **▾** to shrink to a pill, **▸** to expand.
- **Move the visualizer window:** standard macOS title-bar drag.

The panel and visualizer windows are independent — each remembers its own
size and position across launches.

## Pack basics (writing your own)

A pack is a directory with `manifest.json` and a WGSL shader file.

```
my-pack/
├── manifest.json     # metadata + entrypoints
├── shader.wgsl       # vertex + fragment WGSL
└── pack.wasm         # optional: Tier-2 per-frame uniform compute
```

```json
{
  "schemaVersion": 1,
  "id": "my-pack",
  "name": "My Pack",
  "version": "1.0.0",
  "author": "you",
  "shader": "shader.wgsl",
  "wasm": "pack.wasm"
}
```

To distribute, zip the directory with `manifest.json` at the root and
rename the zip to `something.viz`. Other people import it with the **+**
button.

For full pack-authoring details, see [ARCHITECTURE.md](./ARCHITECTURE.md#pack-format)
or run `/new-pack` in Claude Code if you have the project's skill installed.

## What's where

```
src/
├── bun/             # main process (Bun): rendering, audio, packs, IPC
├── mainview/        # controls panel HTML/CSS/JS
├── native/audiotap/ # Swift CLI that streams system audio
└── packs/           # built-in visualizer packs
electrobun.config.ts
package.json
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces fit together.

## Permissions

| Permission         | Why                                          |
|--------------------|----------------------------------------------|
| Screen Recording   | ScreenCaptureKit gates loopback audio behind it. |

If you deny it, you can re-enable it from
**System Settings → Privacy & Security → Screen Recording**, then restart
the app.

## License

MIT — see [LICENSE](./LICENSE).
