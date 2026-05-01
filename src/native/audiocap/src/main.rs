//! Cross-platform system-audio loopback helper for music-visualizer.
//!
//! Frames PCM to stdout and emits NDJSON status events to stderr. The wire
//! format is identical to the original Swift `audiotap` so the Bun-side
//! parser in `src/bun/audio/capture.ts` is unchanged.
//!
//! Stdout frame layout (all little-endian):
//!   u32  magic = 0xA1D10A1D
//!   u32  channels
//!   u32  sampleRate
//!   u32  frameCount    (samples per channel)
//!   f32 * channels * frameCount  (interleaved if stereo)
//!
//! Stderr events: one JSON object per line.
//!   {"type":"ready"}
//!   {"type":"started","sampleRate":48000,"channels":2}
//!   {"type":"stopped"}
//!   {"type":"permission-denied"}
//!   {"type":"error","message":"..."}
//!
//! Loopback selection per-platform:
//!   macOS   — `default_output_device()` + `build_input_stream()`. cpal master
//!             auto-creates a CoreAudio process tap + aggregate device under
//!             the hood (requires macOS 14.2+ and "System Audio Only" TCC
//!             permission).
//!   Windows — same call pattern; cpal's WASAPI backend opens the default
//!             render endpoint in loopback mode.
//!   Linux   — looks for a `*.monitor` source on the host's input device list
//!             (PulseAudio/PipeWire). Requires `cpal` built with the
//!             `pulseaudio` or `pipewire` feature.

use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Error, ErrorKind, FromSample, Sample, SampleFormat, Stream, StreamConfig};

const FRAME_MAGIC: u32 = 0xA1D10A1D;

fn emit_status(line: &str) {
    let mut err = io::stderr().lock();
    let _ = err.write_all(line.as_bytes());
    let _ = err.write_all(b"\n");
    let _ = err.flush();
}

fn emit_error(message: &str) {
    let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
    emit_status(&format!(r#"{{"type":"error","message":"{escaped}"}}"#));
}

fn write_frame(channels: u32, sample_rate: u32, samples: &[f32]) {
    if channels == 0 {
        return;
    }
    let frame_count = (samples.len() as u32) / channels;
    if frame_count == 0 {
        return;
    }
    let payload_bytes = samples.len() * 4;
    let mut buf = Vec::with_capacity(16 + payload_bytes);
    buf.extend_from_slice(&FRAME_MAGIC.to_le_bytes());
    buf.extend_from_slice(&channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&frame_count.to_le_bytes());
    for s in samples {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    let mut out = io::stdout().lock();
    let _ = out.write_all(&buf);
    let _ = out.flush();
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn select_loopback_device(host: &cpal::Host) -> Result<cpal::Device, String> {
    host.default_output_device()
        .ok_or_else(|| "no default output device available for loopback".to_string())
}

#[cfg(target_os = "linux")]
fn select_loopback_device(host: &cpal::Host) -> Result<cpal::Device, String> {
    let devices = host
        .input_devices()
        .map_err(|e| format!("input_devices: {e}"))?;
    let mut fallback: Option<cpal::Device> = None;
    for device in devices {
        let name = device.name().unwrap_or_default();
        if name.ends_with(".monitor") {
            return Ok(device);
        }
        if fallback.is_none() && name.to_lowercase().contains("monitor") {
            fallback = Some(device);
        }
    }
    fallback.ok_or_else(|| {
        "no monitor source found; PulseAudio or PipeWire must be running with a loopback monitor"
            .to_string()
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn select_loopback_device(_host: &cpal::Host) -> Result<cpal::Device, String> {
    Err("system-audio loopback is not supported on this platform".to_string())
}

fn is_permission_denied(err: &Error) -> bool {
    matches!(err.kind(), ErrorKind::PermissionDenied)
}

fn build_loopback_stream(
    device: &cpal::Device,
    config: StreamConfig,
    sample_format: SampleFormat,
) -> Result<Stream, Error> {
    let channels = config.channels as u32;
    let sample_rate = config.sample_rate;
    let err_fn = |e: Error| emit_error(&format!("stream error: {e}"));

    fn make<T>(
        device: &cpal::Device,
        config: StreamConfig,
        channels: u32,
        sample_rate: u32,
        err_fn: impl FnMut(Error) + Send + 'static,
    ) -> Result<Stream, Error>
    where
        T: cpal::SizedSample + Send + 'static,
        f32: FromSample<T>,
    {
        device.build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let f: Vec<f32> = data.iter().map(|&s| f32::from_sample(s)).collect();
                write_frame(channels, sample_rate, &f);
            },
            err_fn,
            None,
        )
    }

    match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                write_frame(channels, sample_rate, data);
            },
            err_fn,
            None,
        ),
        SampleFormat::I16 => make::<i16>(device, config, channels, sample_rate, err_fn),
        SampleFormat::I32 => make::<i32>(device, config, channels, sample_rate, err_fn),
        SampleFormat::U16 => make::<u16>(device, config, channels, sample_rate, err_fn),
        sf => Err(Error::with_message(
            ErrorKind::UnsupportedConfig,
            format!("unsupported sample format: {sf:?}"),
        )),
    }
}

fn run() -> i32 {
    emit_status(r#"{"type":"ready"}"#);

    let shutdown = Arc::new(AtomicBool::new(false));
    {
        let s = shutdown.clone();
        if let Err(e) = ctrlc::set_handler(move || s.store(true, Ordering::SeqCst)) {
            emit_error(&format!("failed to install signal handler: {e}"));
            return 1;
        }
    }

    let host = cpal::default_host();

    let device = match select_loopback_device(&host) {
        Ok(d) => d,
        Err(msg) => {
            emit_error(&msg);
            return 1;
        }
    };

    // Use the output config to discover format on macOS/Windows (the device
    // is the OUTPUT endpoint; cpal taps it as input). On Linux the device is
    // already a monitor input source, so try input config first.
    #[cfg(target_os = "linux")]
    let supported = device
        .default_input_config()
        .or_else(|_| device.default_output_config());
    #[cfg(not(target_os = "linux"))]
    let supported = device
        .default_output_config()
        .or_else(|_| device.default_input_config());

    let supported = match supported {
        Ok(c) => c,
        Err(e) => {
            if is_permission_denied(&e) {
                emit_status(r#"{"type":"permission-denied"}"#);
                return 2;
            }
            emit_error(&format!("default config: {e}"));
            return 1;
        }
    };

    let sample_rate = supported.sample_rate();
    let channels = supported.channels() as u32;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.into();

    let stream = match build_loopback_stream(&device, config, sample_format) {
        Ok(s) => s,
        Err(e) => {
            if is_permission_denied(&e) {
                emit_status(r#"{"type":"permission-denied"}"#);
                return 2;
            }
            emit_error(&format!("build_input_stream: {e}"));
            return 1;
        }
    };

    if let Err(e) = stream.play() {
        if is_permission_denied(&e) {
            emit_status(r#"{"type":"permission-denied"}"#);
            return 2;
        }
        emit_error(&format!("stream.play: {e}"));
        return 1;
    }

    emit_status(&format!(
        r#"{{"type":"started","sampleRate":{sample_rate},"channels":{channels}}}"#
    ));

    while !shutdown.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(50));
    }

    drop(stream);
    emit_status(r#"{"type":"stopped"}"#);
    0
}

fn main() {
    std::process::exit(run());
}
