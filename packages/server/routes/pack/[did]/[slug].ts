import { defineHandler, html } from "nitro";
import { getRouterParams, createError } from "nitro/h3";
import { getDb, type ReleaseRow, type VersionRow } from "../../../lib/db.ts";
import { resolveHandleFromDid } from "../../../lib/did.ts";

export default defineHandler(async (event) => {
	const db = getDb();
	const { did, slug } = getRouterParams(event);

	const release = db
		.prepare("SELECT * FROM releases WHERE did = ? AND rkey = ? AND hidden = 0")
		.get(did, slug) as ReleaseRow | null;

	if (!release) {
		throw createError({ statusCode: 404, statusMessage: "Pack not found" });
	}

	const versions = db
		.prepare(
			"SELECT * FROM versions WHERE release_did = ? AND release_rkey = ? ORDER BY created_at DESC",
		)
		.all(did, slug) as VersionRow[];

	const starCount = (
		db
			.prepare("SELECT COUNT(*) as count FROM stars WHERE subject_uri = ?")
			.get(`at://${did}/com.nickthesick.catnip.release/${slug}`) as { count: number }
	).count;

	const latest = versions[0];
	let tags: string[] = [];
	if (latest) {
		const tagRows = db
			.prepare("SELECT tag FROM tags WHERE version_did = ? AND version_rkey = ?")
			.all(latest.did, latest.rkey) as { tag: string }[];
		tags = tagRows.map((r) => r.tag);
	}

	// Resolve DID to handle (best-effort, falls back to DID)
	const handle = await resolveHandleFromDid(did);
	const authorDisplay = handle ?? did;

	const previewUrl = latest?.preview_path
		? `/api/packs/${did}/${slug}/preview.webp`
		: null;

	const versionList = versions
		.map(
			(v) => `
		<li>
			<strong>v${escapeHtml(v.version)}</strong>
			<time>${v.created_at}</time>
			${v.changelog ? `<p>${escapeHtml(v.changelog)}</p>` : ""}
		</li>
	`,
		)
		.join("\n");

	const tagBadges = tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ");

	return html(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(release.name)} — Cat Nip</title>
	<meta property="og:title" content="${escapeHtml(release.name)}" />
	${release.description ? `<meta property="og:description" content="${escapeHtml(release.description)}" />` : ""}
	${previewUrl ? `<meta property="og:image" content="${previewUrl}" />` : ""}
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
	<style>${CSS}</style>
</head>
<body>
	<header>
		<a href="/" class="back">Cat Nip</a>
	</header>
	<main>
		<div class="detail">
			${previewUrl ? `<img src="${previewUrl}" alt="${escapeHtml(release.name)}" />` : `<div class="placeholder"></div>`}
			<div class="info">
				<h1>${escapeHtml(release.name)}</h1>
				<a class="author" href="/user/${escapeHtml(did)}">by ${escapeHtml(authorDisplay)}</a>
				${release.description ? `<p class="desc">${escapeHtml(release.description)}</p>` : ""}
				<div class="meta">
					<span class="stars">${starCount}</span>
					${tagBadges ? `<div class="tags">${tagBadges}</div>` : ""}
				</div>
				<a class="install-btn" href="catnip://install/${escapeHtml(did)}/${escapeHtml(slug)}">
					Install in Cat Nip
				</a>
			</div>
		</div>
		${
			versions.length > 0
				? `<section class="versions"><h2>Versions</h2><ul>${versionList}</ul></section>`
				: ""
		}
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
	max-width: 900px;
	margin: 0 auto;
}
header { margin-bottom: 2rem; }
.back {
	color: #ffd959;
	text-decoration: none;
	font-weight: 700;
}
.detail {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 2rem;
	margin-bottom: 2rem;
}
@media (max-width: 640px) {
	.detail { grid-template-columns: 1fr; }
}
.detail img, .detail .placeholder {
	width: 100%;
	aspect-ratio: 4/3;
	object-fit: cover;
	background: #1a1a1a;
	border-radius: 8px;
	display: block;
}
.info h1 {
	color: #ffd959;
	font-size: 1.5rem;
	margin-bottom: 0.25rem;
}
.author {
	display: inline-block;
	font-size: 0.75rem;
	color: #666;
	text-decoration: none;
	margin-bottom: 0.75rem;
	word-break: break-all;
}
.author:hover {
	color: #ffd959;
}
.desc {
	color: #aaa;
	font-size: 0.875rem;
	line-height: 1.5;
	margin-bottom: 1rem;
}
.meta { margin-bottom: 1rem; }
.stars {
	color: #ffd959;
	font-size: 0.875rem;
}
.stars::before { content: "\\2605 "; }
.tags { margin-top: 0.5rem; }
.tag {
	display: inline-block;
	background: #222;
	color: #ccc;
	padding: 0.2em 0.6em;
	border-radius: 4px;
	font-size: 0.75rem;
	margin-right: 0.25rem;
}
.install-btn {
	display: inline-block;
	background: #ffd959;
	color: #000;
	padding: 0.75rem 1.5rem;
	border-radius: 6px;
	text-decoration: none;
	font-weight: 700;
	font-size: 0.875rem;
}
.install-btn:hover { background: #ffe680; }
.versions { margin-top: 2rem; }
.versions h2 {
	color: #ffd959;
	font-size: 1rem;
	margin-bottom: 1rem;
}
.versions ul {
	list-style: none;
}
.versions li {
	border-left: 2px solid #333;
	padding: 0.5rem 0 0.5rem 1rem;
	margin-bottom: 0.5rem;
}
.versions time {
	color: #666;
	font-size: 0.75rem;
	margin-left: 0.5rem;
}
.versions p {
	color: #888;
	font-size: 0.75rem;
	margin-top: 0.25rem;
}
`;
