import Foundation

/// Frame magic number identifying an audiotap PCM payload on stdout.
let kAudiotapMagic: UInt32 = 0xA1D10A1D

/// Serial queue for stdout writes so binary frames don't interleave.
private let stdoutQueue = DispatchQueue(label: "audiotap.stdout")
/// Serial queue for stderr writes so JSON lines don't interleave.
private let stderrQueue = DispatchQueue(label: "audiotap.stderr")

/// Write a single audio frame to stdout.
///
/// Layout (all little-endian):
///   u32 magic = 0xA1D10A1D
///   u32 channels
///   u32 sampleRate
///   u32 frameCount  (samples per channel)
///   f32 payload * (channels * frameCount), interleaved if stereo
@inline(__always)
func writeAudioFrame(channels: UInt32,
                     sampleRate: UInt32,
                     frameCount: UInt32,
                     interleavedSamples: UnsafePointer<Float32>,
                     totalSampleCount: Int) {
    var header = [UInt32]()
    header.reserveCapacity(4)
    header.append(kAudiotapMagic.littleEndian)
    header.append(channels.littleEndian)
    header.append(sampleRate.littleEndian)
    header.append(frameCount.littleEndian)

    var data = Data(capacity: 16 + totalSampleCount * MemoryLayout<Float32>.size)
    header.withUnsafeBufferPointer { buf in
        data.append(UnsafeBufferPointer(start: buf.baseAddress, count: 4))
    }
    interleavedSamples.withMemoryRebound(to: UInt8.self, capacity: totalSampleCount * MemoryLayout<Float32>.size) { ptr in
        data.append(ptr, count: totalSampleCount * MemoryLayout<Float32>.size)
    }

    stdoutQueue.sync {
        FileHandle.standardOutput.write(data)
    }
}

/// Emit a newline-delimited JSON status event on stderr.
func emitStatus(_ obj: [String: Any]) {
    stderrQueue.sync {
        guard JSONSerialization.isValidJSONObject(obj),
              var data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) else {
            return
        }
        data.append(0x0A) // newline
        FileHandle.standardError.write(data)
    }
}

/// Convenience: emit a `{"type":"error","message":"..."}` event.
func emitError(_ message: String) {
    emitStatus(["type": "error", "message": message])
}
