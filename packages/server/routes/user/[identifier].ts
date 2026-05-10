/**
 * GET /user/:identifier
 *
 * SSR profile page for a user. Shows their handle, pack count, total stars,
 * a grid of their packs, and an "Install All" button that triggers the
 * catnip://install-all/:did deep link.
 *
 * The identifier can be a DID (did:plc:... or did:web:...) or an AT Protocol handle.
 * If a handle is provided, it is resolved to a DID first.
 */

import { defineHandler, html } from "nitro";
import { getRouterParams, createError } from "nitro/h3";
import {
	CompositeHandleResolver,
	DohJsonHandleResolver,
	WellKnownHandleResolver,
	CompositeDidDocumentResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	LocalActorResolver,
} from "@atcute/identity-resolver";
import { getDb, getPacksByDid } from "../../lib/db.ts";

let _handleResolver: CompositeHandleResolver | null = null;
let _actorResolver: LocalActorResolver | null = null;

function getHandleResolver(): CompositeHandleResolver {
	if (!_handleResolver) {
		_handleResolver = new CompositeHandleResolver({
			methods: {
				http: new WellKnownHandleResolver(),
				dns: new DohJsonHandleResolver({
					dohUrl: "https://cloudflare-dns.com/dns-query",
				}),
			},
		});
	}
	return _handleResolver;
}

function getActorResolver(): LocalActorResolver {
	if (!_actorResolver) {
		_actorResolver = new LocalActorResolver({
			handleResolver: getHandleResolver(),
			didDocumentResolver: new CompositeDidDocumentResolver({
				methods: {
					plc: new PlcDidDocumentResolver(),
					web: new WebDidDocumentResolver(),
				},
			}),
		});
	}
	return _actorResolver;
}

const HANDLE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function isDid(s: string): boolean {
	return s.startsWith("did:");
}

export default defineHandler(async (event) => {
	const { identifier } = getRouterParams(event);

	if (!identifier) {
		throw createError({ statusCode: 400, statusMessage: "Missing identifier" });
	}

	let did: string;
	let handle: string | null = null;

	if (isDid(identifier)) {
		did = identifier;
		// Try to resolve the handle for display
		try {
			const actor = await getActorResolver().resolve(did as `did:plc:${string}`);
			handle = actor.handle;
		} catch {
			// best-effort
		}
	} else {
		// Treat as a handle
		if (!HANDLE_RE.test(identifier) || identifier.length > 253) {
			throw createError({ statusCode: 400, statusMessage: "Invalid handle format" });
		}
		handle = identifier;
		try {
			did = await getHandleResolver().resolve(identifier as `${string}.${string}`);
		} catch {
			throw createError({ statusCode: 404, statusMessage: `Could not resolve handle: ${identifier}` });
		}
	}

	const db = getDb();
	const packs = getPacksByDid(db, did);

	if (packs.length === 0 && !handle) {
		throw createError({ statusCode: 404, statusMessage: "User not found" });
	}

	const totalStars = packs.reduce((sum, p) => sum + p.star_count, 0);
	const displayName = handle ?? did;

	const packCards = packs
		.map(
			(p) => `
		<a class="card" href="/pack/${escapeHtml(p.did)}/${escapeHtml(p.slug)}">
			${
				p.preview_path
					? `<img src="/api/packs/${escapeHtml(p.did)}/${escapeHtml(p.slug)}/preview.webp" alt="${escapeHtml(p.name)}" loading="lazy" />`
					: `<div class="placeholder"></div>`
			}
			<div class="card-body">
				<h2>${escapeHtml(p.name)}</h2>
				${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
				<div class="card-meta">
					<span class="stars">${p.star_count}</span>
					${p.latest_version ? `<span class="version">v${escapeHtml(p.latest_version)}</span>` : ""}
				</div>
			</div>
		</a>
	`,
		)
		.join("\n");

	return html(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(displayName)} — Cat Nip</title>
	<meta property="og:title" content="${escapeHtml(displayName)} — Cat Nip" />
	<meta property="og:description" content="${packs.length} pack${packs.length !== 1 ? "s" : ""} published" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
	<style>${CSS}</style>
</head>
<body>
	<header>
		<a href="/" class="back">Cat Nip</a>
	</header>
	<main>
		<div class="profile">
			<h1>${escapeHtml(displayName)}</h1>
			<div class="profile-stats">
				<span>${packs.length} pack${packs.length !== 1 ? "s" : ""}</span>
				<span class="stars">${totalStars}</span>
			</div>
			${
				packs.length > 1
					? `<a class="install-all-btn" href="catnip://install-all/${escapeHtml(did)}">Install All Packs</a>`
					: ""
			}
		</div>
		<div class="grid">
			${packCards || "<p>No packs published yet.</p>"}
		</div>
	</main>
</body>
</html>`);
});

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
	background: #000;
	color: #fff;
	font-family: 'Space Mono', monospace;
	padding: 2rem;
	max-width: 1200px;
	margin: 0 auto;
}
header { margin-bottom: 2rem; }
.back {
	color: #ffd959;
	text-decoration: none;
	font-weight: 700;
}
.profile {
	margin-bottom: 2rem;
	padding-bottom: 1.5rem;
	border-bottom: 1px solid #222;
}
.profile h1 {
	color: #ffd959;
	font-size: 1.5rem;
	margin-bottom: 0.5rem;
	word-break: break-all;
}
.profile-stats {
	display: flex;
	gap: 1.5rem;
	color: #888;
	font-size: 0.875rem;
	margin-bottom: 1rem;
}
.profile-stats .stars {
	color: #ffd959;
}
.profile-stats .stars::before {
	content: "\\2605 ";
}
.install-all-btn {
	display: inline-block;
	background: #ffd959;
	color: #000;
	padding: 0.75rem 1.5rem;
	border-radius: 6px;
	text-decoration: none;
	font-weight: 700;
	font-size: 0.875rem;
}
.install-all-btn:hover { background: #ffe680; }
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 1.5rem;
}
.card {
	background: #111;
	border: 1px solid #222;
	border-radius: 8px;
	overflow: hidden;
	text-decoration: none;
	color: inherit;
	transition: border-color 0.15s;
}
.card:hover {
	border-color: #ffd959;
}
.card img, .card .placeholder {
	width: 100%;
	aspect-ratio: 4/3;
	object-fit: cover;
	background: #1a1a1a;
	display: block;
}
.card-body {
	padding: 1rem;
}
.card-body h2 {
	font-size: 1rem;
	color: #ffd959;
	margin-bottom: 0.25rem;
}
.card-body p {
	font-size: 0.75rem;
	color: #888;
	line-height: 1.4;
	margin-bottom: 0.5rem;
}
.card-meta {
	display: flex;
	justify-content: space-between;
	align-items: center;
}
.stars {
	font-size: 0.75rem;
	color: #ffd959;
}
.stars::before {
	content: "\\2605 ";
}
.version {
	font-size: 0.75rem;
	color: #666;
}
`;
