import Foundation
#if canImport(Darwin)
import Darwin
#endif

// Disable line buffering on stdout — we write raw PCM frames there.
setbuf(stdout, nil)
setbuf(stderr, nil)

emitStatus(["type": "ready"])

guard #available(macOS 13.0, *) else {
    emitError("audiotap requires macOS 13 or later")
    exit(1)
}

let capture = AudioCapture()

// Use a DispatchSource for SIGINT/SIGTERM so we can cleanly stop the stream
// from a Swift context. The default signal disposition must be ignored for
// DispatchSource to receive it.
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)

let signalQueue = DispatchQueue(label: "audiotap.signals")
let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: signalQueue)
let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: signalQueue)

// Use a semaphore to block main until shutdown completes.
let shutdownSem = DispatchSemaphore(value: 0)
var shuttingDown = false
let shutdownLock = NSLock()

func beginShutdown() {
    shutdownLock.lock()
    if shuttingDown {
        shutdownLock.unlock()
        return
    }
    shuttingDown = true
    shutdownLock.unlock()

    Task {
        await capture.stop()
        shutdownSem.signal()
    }
}

sigintSource.setEventHandler { beginShutdown() }
sigtermSource.setEventHandler { beginShutdown() }
sigintSource.resume()
sigtermSource.resume()

// Kick off capture asynchronously.
Task {
    do {
        try await capture.start()
    } catch CaptureError.permissionDenied {
        // permission-denied status already emitted by AudioCapture.start.
        exit(2)
    } catch CaptureError.noDisplays {
        emitError("no displays available to capture")
        exit(1)
    } catch {
        if isPermissionDenied(error) {
            emitStatus(["type": "permission-denied"])
            exit(2)
        }
        emitError("start failed: \(error.localizedDescription)")
        exit(1)
    }
}

// Park the main thread until a signal triggers shutdown.
shutdownSem.wait()
exit(0)
