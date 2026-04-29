# audiotap

A small macOS-native Swift CLI that captures system audio (the default audio mix of the entire desktop) via ScreenCaptureKit and writes framed binary PCM to stdout, with newline-delimited JSON status events on stderr. Intended to be spawned as a child process by the parent Bun/Electrobun app.

## Build

```
swift build -c release --arch arm64 --arch x86_64 && cp .build/apple/Products/Release/audiotap ./audiotap
```

If universal builds are not available in your environment, fall back to:

```
swift build -c release && cp .build/release/audiotap ./audiotap
```

## Protocol

On launch, audiotap immediately begins capturing system audio via ScreenCaptureKit:

1. Configure an `SCContentFilter` covering all displays excluding none.
2. Configure `SCStreamConfiguration` with `capturesAudio = true`. Sample rate: try to match SCKit's native sample rate (commonly 48000 Hz, stereo).
3. Start the SCStream and write each audio sample buffer to stdout as a **framed binary message**:
   - `u32 LE magic = 0xA1D10A1D`
   - `u32 LE channels`
   - `u32 LE sampleRate`
   - `u32 LE frameCount` (samples per channel)
   - `f32 LE payload` x `channels * frameCount` (interleaved if stereo)
4. On stderr, write **newline-delimited JSON status events**:
   - On startup: `{"type":"ready"}`
   - When capture begins: `{"type":"started","sampleRate":48000,"channels":2}`
   - On permission denial / `SCStreamErrorUserDeclined`: `{"type":"permission-denied"}` then exit non-zero
   - On any error: `{"type":"error","message":"..."}`
   - On clean shutdown: `{"type":"stopped"}` then exit 0
5. Trap SIGTERM/SIGINT to call `stream.stopCapture()`, drain, emit "stopped", and exit.
