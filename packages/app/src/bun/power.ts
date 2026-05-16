/**
 * Prevents macOS system sleep while the app is running.
 *
 * Uses the built-in `caffeinate` utility with:
 *   -d  prevent the display from sleeping
 *   -i  prevent the system from idle sleeping
 *
 * Call `preventSleep()` when the render engine starts and
 * `allowSleep()` during shutdown to release the assertion.
 */

import type { Subprocess } from "bun";

let proc: Subprocess | null = null;

/** Spawn caffeinate to hold a sleep assertion. Idempotent. */
export function preventSleep(): void {
	if (proc) return;
	try {
		proc = Bun.spawn(["caffeinate", "-di"], {
			stdout: "ignore",
			stderr: "ignore",
		});
	} catch (err) {
		console.warn("[power] failed to spawn caffeinate:", err);
	}
}

/** Kill the caffeinate process, allowing the system to sleep again. Idempotent. */
export function allowSleep(): void {
	if (!proc) return;
	try {
		proc.kill();
	} catch {
		// already exited
	}
	proc = null;
}
