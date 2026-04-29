import Foundation
import AVFoundation
import CoreMedia
import ScreenCaptureKit

/// Captures system audio via ScreenCaptureKit and writes framed PCM to stdout.
@available(macOS 13.0, *)
final class AudioCapture: NSObject, SCStreamDelegate, SCStreamOutput {
    private var stream: SCStream?
    private let sampleQueue = DispatchQueue(label: "audiotap.sckit.audio")

    /// Negotiated stream config — what we asked SCKit for.
    private let requestedSampleRate: Int = 48_000
    private let requestedChannelCount: Int = 2

    /// Lazily-allocated converter when SCKit hands us a non-Float32-interleaved layout.
    private var converter: AVAudioConverter?
    private var converterInputFormat: AVAudioFormat?
    private var converterOutputFormat: AVAudioFormat?

    /// Reusable scratch buffer for interleaved Float32 conversion output.
    private var interleavedScratch: [Float32] = []

    /// Whether we have already emitted the "started" status.
    private var didEmitStarted = false

    /// Begin capture. Resolves once `startCapture` returns (or throws).
    func start() async throws {
        // Discover shareable content. This will trigger the screen-recording
        // permission prompt the first time the user runs the binary.
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        } catch {
            // Most permission denials surface as an error here.
            if isPermissionDenied(error) {
                emitStatus(["type": "permission-denied"])
                throw CaptureError.permissionDenied
            }
            throw error
        }

        guard let display = content.displays.first else {
            throw CaptureError.noDisplays
        }

        // Filter that captures the entire display; we don't actually use the
        // video, but SCKit currently requires a non-empty filter to capture
        // audio.
        let filter = SCContentFilter(display: display, excludingWindows: [])

        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.sampleRate = requestedSampleRate
        cfg.channelCount = requestedChannelCount
        cfg.excludesCurrentProcessAudio = true
        // Keep the (unused) video stream small/cheap.
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 fps
        cfg.queueDepth = 6
        cfg.showsCursor = false

        let stream = SCStream(filter: filter, configuration: cfg, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        // We have to add a screen output too, otherwise SCKit may refuse to
        // start. We'll just discard the video sample buffers.
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)

        self.stream = stream

        try await stream.startCapture()

        if !didEmitStarted {
            didEmitStarted = true
            emitStatus([
                "type": "started",
                "sampleRate": requestedSampleRate,
                "channels": requestedChannelCount
            ])
        }
    }

    /// Stop capture and emit a "stopped" status event.
    func stop() async {
        guard let stream = stream else { return }
        do {
            try await stream.stopCapture()
        } catch {
            emitError("stopCapture failed: \(error.localizedDescription)")
        }
        emitStatus(["type": "stopped"])
    }

    // MARK: - SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        if isPermissionDenied(error) {
            emitStatus(["type": "permission-denied"])
            exit(2)
        } else {
            emitError("stream stopped: \(error.localizedDescription)")
            exit(1)
        }
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard CMSampleBufferIsValid(sampleBuffer) else { return }

        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else {
            return
        }
        let asbd = asbdPtr.pointee

        let frameCount = Int(CMSampleBufferGetNumSamples(sampleBuffer))
        if frameCount <= 0 { return }

        let channels = Int(asbd.mChannelsPerFrame)
        if channels <= 0 { return }

        let sampleRate = UInt32(asbd.mSampleRate.rounded())

        // Pull the AudioBufferList out of the sample buffer.
        var blockBuffer: CMBlockBuffer?
        var ablSize: Int = 0
        // Determine required buffer list size first.
        let szStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &ablSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: nil)
        if szStatus != noErr || ablSize == 0 {
            return
        }

        let ablRaw = UnsafeMutableRawPointer.allocate(byteCount: ablSize, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { ablRaw.deallocate() }
        let abl = ablRaw.bindMemory(to: AudioBufferList.self, capacity: 1)

        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: abl,
            bufferListSize: ablSize,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer)
        if status != noErr {
            return
        }

        // Determine the layout SCKit handed us.
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        let bytesPerSample = Int(asbd.mBitsPerChannel / 8)

        let totalInterleavedSamples = frameCount * channels

        // Common SCKit case: 32-bit float, non-interleaved (one buffer per channel).
        if isFloat && bytesPerSample == 4 {
            if interleavedScratch.count < totalInterleavedSamples {
                interleavedScratch = [Float32](repeating: 0, count: totalInterleavedSamples)
            }

            let abList = UnsafeMutableAudioBufferListPointer(abl)

            if isNonInterleaved {
                // One buffer per channel.
                let nBuffers = min(abList.count, channels)
                interleavedScratch.withUnsafeMutableBufferPointer { outBuf in
                    guard let outBase = outBuf.baseAddress else { return }
                    for ch in 0..<nBuffers {
                        let buf = abList[ch]
                        guard let mData = buf.mData else { continue }
                        let inPtr = mData.assumingMemoryBound(to: Float32.self)
                        let availableFrames = Int(buf.mDataByteSize) / MemoryLayout<Float32>.size
                        let nFrames = min(frameCount, availableFrames)
                        for f in 0..<nFrames {
                            outBase[f * channels + ch] = inPtr[f]
                        }
                    }
                }
                interleavedScratch.withUnsafeBufferPointer { ptr in
                    guard let base = ptr.baseAddress else { return }
                    writeAudioFrame(channels: UInt32(channels),
                                    sampleRate: sampleRate,
                                    frameCount: UInt32(frameCount),
                                    interleavedSamples: base,
                                    totalSampleCount: totalInterleavedSamples)
                }
            } else {
                // Already interleaved.
                if let buf = abList.first, let mData = buf.mData {
                    let inPtr = mData.assumingMemoryBound(to: Float32.self)
                    writeAudioFrame(channels: UInt32(channels),
                                    sampleRate: sampleRate,
                                    frameCount: UInt32(frameCount),
                                    interleavedSamples: inPtr,
                                    totalSampleCount: totalInterleavedSamples)
                }
            }
            return
        }

        // Fallback: anything else, route through AVAudioConverter to get
        // Float32 interleaved.
        guard let inputFormat = AVAudioFormat(streamDescription: asbdPtr) else { return }

        if converter == nil
            || converterInputFormat?.streamDescription.pointee.mSampleRate != asbd.mSampleRate
            || converterInputFormat?.channelCount != AVAudioChannelCount(channels) {
            guard let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                                   sampleRate: asbd.mSampleRate,
                                                   channels: AVAudioChannelCount(channels),
                                                   interleaved: true) else { return }
            converter = AVAudioConverter(from: inputFormat, to: outputFormat)
            converterInputFormat = inputFormat
            converterOutputFormat = outputFormat
        }

        guard let converter = converter,
              let outputFormat = converterOutputFormat,
              let inputBuffer = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: abl) else {
            return
        }
        inputBuffer.frameLength = AVAudioFrameCount(frameCount)

        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat,
                                                  frameCapacity: AVAudioFrameCount(frameCount)) else {
            return
        }

        var pulled = false
        var err: NSError?
        let _ = converter.convert(to: outputBuffer, error: &err) { _, outStatus in
            if pulled {
                outStatus.pointee = .endOfStream
                return nil
            }
            pulled = true
            outStatus.pointee = .haveData
            return inputBuffer
        }
        if let err = err {
            emitError("AVAudioConverter: \(err.localizedDescription)")
            return
        }
        guard let floatData = outputBuffer.floatChannelData else { return }
        let nFrames = Int(outputBuffer.frameLength)
        let nCh = Int(outputFormat.channelCount)
        let total = nFrames * nCh
        // floatChannelData with interleaved=true gives a single channel
        // pointer holding interleaved data.
        let base = floatData[0]
        writeAudioFrame(channels: UInt32(nCh),
                        sampleRate: UInt32(outputFormat.sampleRate.rounded()),
                        frameCount: UInt32(nFrames),
                        interleavedSamples: base,
                        totalSampleCount: total)
    }
}

enum CaptureError: Error {
    case permissionDenied
    case noDisplays
}

/// Best-effort detection of permission denial across the various error
/// surfaces SCKit uses.
func isPermissionDenied(_ error: Error) -> Bool {
    let nsErr = error as NSError
    // SCStreamError domain values.
    if nsErr.domain == "com.apple.ScreenCaptureKit.SCStreamErrorDomain" {
        // SCStreamErrorUserDeclined == -3801 historically. Be generous and
        // treat any "declined" / "denied" wording as denial too.
        if nsErr.code == -3801 { return true }
    }
    let desc = nsErr.localizedDescription.lowercased()
    if desc.contains("declined") || desc.contains("denied") || desc.contains("not authorized") {
        return true
    }
    return false
}
