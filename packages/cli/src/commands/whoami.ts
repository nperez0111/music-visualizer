import { parseArgs } from "util";
import { loadSession, clearSession, getAuthenticatedClient } from "../lib/auth.ts";
import type {} from "@atcute/atproto";

export async function run(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			help: { type: "boolean", short: "h" },
			logout: { type: "boolean" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip whoami — Show current identity\n");
		console.log("Usage: catnip whoami [--logout]\n");
		console.log("Options:");
		console.log("  --logout    Clear the stored session");
		return;
	}

	if (values.logout) {
		clearSession();
		console.log("Logged out. Session cleared.");
		return;
	}

	const session = loadSession();
	if (!session) {
		console.log("Not logged in. Run `catnip login <handle>` to authenticate.");
		return;
	}

	console.log(`Handle:  ${session.handle}`);
	console.log(`DID:     ${session.did}`);
	console.log(`Service: ${session.service}`);

	// Try to verify the session is still valid
	try {
		const client = await getAuthenticatedClient();
		await client.get("com.atproto.server.getSession", {});
		console.log(`Status:  active`);
	} catch {
		console.log(`Status:  session may be expired — run \`catnip login\` to refresh`);
	}
}
