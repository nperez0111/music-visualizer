import { defineHandler, html } from "nitro";
import { getDb } from "../lib/db.ts";
import { resolveHandleFromDid } from "../lib/did.ts";

export default defineHandler(async () => {
	const db = getDb();

	const packs = db
		.prepare(`
			SELECT
				r.did,
				r.rkey,
				r.name,
				r.slug,
				r.description,
				(SELECT COUNT(*) FROM stars s WHERE s.subject_uri = 'at://' || r.did || '/com.nickthesick.catnip.release/' || r.rkey) AS star_count,
				(SELECT v.preview_path FROM versions v WHERE v.release_did = r.did AND v.release_rkey = r.rkey ORDER BY v.created_at DESC LIMIT 1) AS preview_path
			FROM releases r
			WHERE r.hidden = 0
			ORDER BY r.created_at DESC
			LIMIT 100
		`)
		.all() as Array<{
		did: string;
		rkey: string;
		name: string;
		slug: string;
		description: string | null;
		star_count: number;
		preview_path: string | null;
	}>;

	// Resolve unique DIDs to handles (best-effort, parallel)
	const uniqueDids = [...new Set(packs.map((p) => p.did))];
	const handleResults = await Promise.allSettled(
		uniqueDids.map((did) => resolveHandleFromDid(did)),
	);
	const handleMap = new Map<string, string>();
	uniqueDids.forEach((did, i) => {
		const result = handleResults[i];
		if (result?.status === "fulfilled" && result.value) {
			handleMap.set(did, result.value);
		}
	});

	const packCards = packs
		.map(
			(p) => `
		<div class="card">
			<a class="card-link" href="/pack/${p.did}/${p.slug}">
				${
					p.preview_path
						? `<img src="/api/packs/${p.did}/${p.slug}/preview.webp" alt="${escapeHtml(p.name)}" loading="lazy" />`
						: `<div class="placeholder"></div>`
				}
				<div class="card-body">
					<h2>${escapeHtml(p.name)}</h2>
					${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
				</div>
			</a>
			<div class="card-footer">
				<a class="author" href="/user/${p.did}">${escapeHtml(handleMap.get(p.did) ?? p.did)}</a>
				<span class="stars">${p.star_count}</span>
			</div>
		</div>
	`,
		)
		.join("\n");

	return html(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Cat Nip — Pack Registry</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
	<style>${CSS}</style>
</head>
<body>
	<header>
		<h1>Cat Nip</h1>
		<p>Music visualizer packs</p>
	</header>
	<main>
		<div class="grid">
			${packCards || "<p>No packs yet. Be the first to publish one.</p>"}
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
}
header {
	text-align: center;
	margin-bottom: 2rem;
}
header h1 {
	color: #ffd959;
	font-size: 2rem;
}
header p {
	color: #888;
	font-size: 0.875rem;
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 1.5rem;
	max-width: 1200px;
	margin: 0 auto;
}
.card {
	background: #111;
	border: 1px solid #222;
	border-radius: 8px;
	overflow: hidden;
	transition: border-color 0.15s;
}
.card:hover {
	border-color: #ffd959;
}
.card-link {
	text-decoration: none;
	color: inherit;
	display: block;
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
}
.card-footer {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 0 1rem 0.75rem;
}
.author {
	font-size: 0.7rem;
	color: #666;
	text-decoration: none;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.author:hover {
	color: #ffd959;
}
.stars {
	font-size: 0.75rem;
	color: #ffd959;
}
.stars::before {
	content: "\\2605 ";
}
`;
