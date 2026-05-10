#!/usr/bin/env bun

const COMMANDS: Record<string, { description: string; load: () => Promise<{ run: (args: string[]) => Promise<void> }> }> = {
	build: {
		description: "Zip a pack directory into a .viz archive",
		load: () => import("./commands/build.ts"),
	},
	validate: {
		description: "Check manifest + compile shader",
		load: () => import("./commands/validate.ts"),
	},
	info: {
		description: "Display pack metadata from a .viz or directory",
		load: () => import("./commands/info.ts"),
	},
	create: {
		description: "Scaffold a new pack (name, shader language, tier)",
		load: () => import("./commands/create.ts"),
	},
	preview: {
		description: "Headless render to PNG or animated WebP",
		load: () => import("./commands/preview.ts"),
	},
	publish: {
		description: "Upload .viz to PDS, create release + version records",
		load: () => import("./commands/publish.ts"),
	},
	login: {
		description: "AT Protocol OAuth login",
		load: () => import("./commands/login.ts"),
	},
	whoami: {
		description: "Show current identity",
		load: () => import("./commands/whoami.ts"),
	},
};

function printUsage(): void {
	console.log("catnip — Cat Nip pack CLI\n");
	console.log("Usage: catnip <command> [options]\n");
	console.log("Commands:");
	const maxLen = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
	for (const [name, cmd] of Object.entries(COMMANDS)) {
		console.log(`  ${name.padEnd(maxLen + 2)}${cmd.description}`);
	}
	console.log("\nRun 'catnip <command> --help' for command-specific help.");
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		printUsage();
		process.exit(0);
	}

	if (command === "--version" || command === "-v") {
		const pkg = await import("../package.json");
		console.log(pkg.version);
		process.exit(0);
	}

	const entry = COMMANDS[command];
	if (!entry) {
		console.error(`Unknown command: ${command}\n`);
		printUsage();
		process.exit(1);
	}

	try {
		const mod = await entry.load();
		await mod.run(args.slice(1));
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	// Explicitly exit — some commands (e.g. login) instantiate an OAuthClient whose
	// internal MemoryStore auto-purge timers keep the event loop alive indefinitely.
	process.exit(0);
}

main();
