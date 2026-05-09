# Cat Nip

Your music on catnip. A desktop music visualizer built on
[Electrobun](https://blackboard.sh/electrobun/) and WebGPU. It captures the
audio playing on your system (Spotify, browser, anything that makes sound)
and renders shader-based visuals that react in real time. Visualizers are
hot-swappable "packs" — drop in someone else's `.viz` file and use it
immediately.

> **Status:** macOS 14.2+ today; Windows and Linux ride the same audio
> helper (cpal-based). Render and pack systems are cross-platform.

## Features

- **Captures system audio** with no virtual driver. macOS uses CoreAudio
  process taps (14.2+); Windows uses WASAPI loopback; Linux uses the
  PulseAudio/PipeWire monitor source. First run on macOS prompts for the
  "System Audio" privacy permission.
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
bun run build:audiocap   # builds the cpal-based system-audio helper (one-time)
bun run build:packs      # compiles the AssemblyScript sample pack (one-time)
bun run dev
```

`build:audiocap` requires [`rustup`](https://rustup.rs) with both
`aarch64-apple-darwin` and `x86_64-apple-darwin` targets installed
(it produces a universal binary). One-time setup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
~/.cargo/bin/rustup target add x86_64-apple-darwin
```

On Windows and Linux, the script falls back to a host-architecture build
and only requires `cargo` on PATH.

The first time the app starts on macOS 14.2+, the system will prompt for
**System Audio** permission. Grant it — without it, the loopback stream
silently records zero. The visualizer falls back to synthesized features
so you'll still see motion.

## Using it

- **Switch packs:** pick one from the **pack** dropdown. Crossfades over
  ~1.5 seconds.
- **Import a .viz:** click the **+** button next to the dropdown. Pick a
  `.viz` file. It's extracted into `~/Library/Application Support/cat-nip.nickthesick.com/packs/<id>/`
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
packages/
├── app/             # Electrobun desktop visualizer
│   └── src/
│       ├── bun/             # main process: rendering, audio, packs, IPC
│       ├── mainview/        # controls panel HTML/CSS/JS
│       ├── native/audiocap/ # Rust CLI: system-audio loopback (cpal)
│       └── packs/           # built-in visualizer packs
├── shared/          # manifest types, validation, hashing, limits
├── cli/             # CLI tool (catnip)
├── server/          # registry server (Nitro)
└── lexicons/        # AT Protocol schemas
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces fit together.

## Permissions

| Platform | Permission        | Why                                              |
|----------|-------------------|--------------------------------------------------|
| macOS    | System Audio      | CoreAudio process taps gate loopback behind it.  |
| Windows  | (none)            | WASAPI loopback needs no privilege.              |
| Linux    | (none)            | PulseAudio/PipeWire monitor source is open.      |

On macOS, if you deny the permission, re-enable it at **System Settings →
Privacy & Security → System Audio Recording** (the new "System Audio
Only" entry, not the legacy "Screen Recording") and restart the app.
A common gotcha: granting *only* "Screen Recording" causes a silent
record of zeros — make sure the System-Audio toggle is on.

## License

MIT — see [LICENSE](./LICENSE).
