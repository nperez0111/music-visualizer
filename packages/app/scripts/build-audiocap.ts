#!/usr/bin/env bun
// Builds the audiocap helper binary. On macOS, produces a universal
// (arm64+x86_64) binary via two cargo invocations + lipo. On Windows
// and Linux, produces a single host-architecture binary.
//
// Cargo is resolved in this order: rustup-managed (~/.cargo/bin), then
// PATH. rustup is required for macOS universal builds (Homebrew rust
// only ships the host triple's std).

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const CRATE_DIR = "src/native/audiocap";
const OUTPUT_BIN = join(CRATE_DIR, platform() === "win32" ? "audiocap.exe" : "audiocap");

const rustupCargo = join(homedir(), ".cargo", "bin", "cargo");
const cargo = existsSync(rustupCargo) ? rustupCargo : "cargo";

function run(cmd: string, args: string[], cwd?: string): void {
	const result = spawnSync(cmd, args, { stdio: "inherit", cwd });
	if (result.status !== 0) {
		console.error(`[build:audiocap] ${cmd} ${args.join(" ")} failed (exit ${result.status})`);
		process.exit(result.status ?? 1);
	}
}

function buildTarget(triple: string): string {
	console.log(`[build:audiocap] cargo build --release --target ${triple}`);
	run(cargo, ["build", "--release", "--target", triple], CRATE_DIR);
	return join(CRATE_DIR, "target", triple, "release", "audiocap");
}

if (platform() === "darwin") {
	if (cargo !== rustupCargo) {
		console.error(
			"[build:audiocap] rustup not found at ~/.cargo/bin. Universal-binary builds need rustup with both",
		);
		console.error(
			"  aarch64-apple-darwin and x86_64-apple-darwin targets installed. Install via:",
		);
		console.error("    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y");
		console.error("    rustup target add aarch64-apple-darwin x86_64-apple-darwin");
		process.exit(1);
	}
	const arm64 = buildTarget("aarch64-apple-darwin");
	const x86_64 = buildTarget("x86_64-apple-darwin");
	console.log(`[build:audiocap] lipo -> ${OUTPUT_BIN}`);
	run("lipo", ["-create", arm64, x86_64, "-output", OUTPUT_BIN]);
	const info = spawnSync("lipo", ["-info", OUTPUT_BIN], { encoding: "utf8" });
	if (info.stdout) process.stdout.write(info.stdout);
} else {
	console.log("[build:audiocap] cargo build --release (host arch)");
	run(cargo, ["build", "--release"], CRATE_DIR);
	const src = join(CRATE_DIR, "target", "release", platform() === "win32" ? "audiocap.exe" : "audiocap");
	run(platform() === "win32" ? "copy" : "cp", [src, OUTPUT_BIN]);
}

console.log(`[build:audiocap] done -> ${OUTPUT_BIN}`);
