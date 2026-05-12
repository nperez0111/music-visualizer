import { defineHandler, html } from "nitro";
import { getDb, getAllTags } from "../lib/db.ts";
import { resolveHandleFromDid } from "../lib/did.ts";

type PackRow = {
	did: string;
	rkey: string;
	name: string;
	slug: string;
	description: string | null;
	star_count: number;
	install_count: number;
	preview_path: string | null;
};

export default defineHandler(async () => {
	const db = getDb();

	// Recent packs (newest 12)
	const recentPacks = db
		.prepare(`
			SELECT
				r.did,
				r.rkey,
				r.name,
				r.slug,
				r.description,
				(SELECT COUNT(*) FROM stars s WHERE s.subject_uri = 'at://' || r.did || '/com.nickthesick.catnip.release/' || r.rkey) AS star_count,
				COALESCE((SELECT ic.count FROM install_counts ic WHERE ic.did = r.did AND ic.rkey = r.rkey), 0) AS install_count,
				(SELECT v.preview_path FROM versions v WHERE v.release_did = r.did AND v.release_rkey = r.rkey ORDER BY v.created_at DESC LIMIT 1) AS preview_path
			FROM releases r
			WHERE r.hidden = 0
			ORDER BY r.created_at DESC
			LIMIT 12
		`)
		.all() as PackRow[];

	// Featured packs (most starred, top 6)
	const featuredPacks = db
		.prepare(`
			SELECT
				r.did,
				r.rkey,
				r.name,
				r.slug,
				r.description,
				(SELECT COUNT(*) FROM stars s WHERE s.subject_uri = 'at://' || r.did || '/com.nickthesick.catnip.release/' || r.rkey) AS star_count,
				COALESCE((SELECT ic.count FROM install_counts ic WHERE ic.did = r.did AND ic.rkey = r.rkey), 0) AS install_count,
				(SELECT v.preview_path FROM versions v WHERE v.release_did = r.did AND v.release_rkey = r.rkey ORDER BY v.created_at DESC LIMIT 1) AS preview_path
			FROM releases r
			WHERE r.hidden = 0
			ORDER BY star_count DESC, r.created_at DESC
			LIMIT 6
		`)
		.all() as PackRow[];

	// Most popular packs (most installs, top 6)
	const popularPacks = db
		.prepare(`
			SELECT
				r.did,
				r.rkey,
				r.name,
				r.slug,
				r.description,
				(SELECT COUNT(*) FROM stars s WHERE s.subject_uri = 'at://' || r.did || '/com.nickthesick.catnip.release/' || r.rkey) AS star_count,
				COALESCE((SELECT ic.count FROM install_counts ic WHERE ic.did = r.did AND ic.rkey = r.rkey), 0) AS install_count,
				(SELECT v.preview_path FROM versions v WHERE v.release_did = r.did AND v.release_rkey = r.rkey ORDER BY v.created_at DESC LIMIT 1) AS preview_path
			FROM releases r
			WHERE r.hidden = 0
			ORDER BY install_count DESC, r.created_at DESC
			LIMIT 6
		`)
		.all() as PackRow[];

	// Total pack count
	const totalCount = (
		db.prepare("SELECT COUNT(*) as count FROM releases WHERE hidden = 0").get() as { count: number }
	).count;

	// Popular tags (top 12)
	const tags = getAllTags(db).slice(0, 12);

	// Resolve unique DIDs to handles (best-effort, parallel)
	const allPacks = [...recentPacks, ...featuredPacks, ...popularPacks];
	const uniqueDids = [...new Set(allPacks.map((p) => p.did))];
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

	function renderCard(p: PackRow): string {
		return `
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
				<div class="card-stats">
					<span class="stars">${p.star_count}</span>
					<span class="installs">${p.install_count}</span>
				</div>
			</div>
		</div>`;
	}

	const featuredCards = featuredPacks.map(renderCard).join("\n");
	const popularCards = popularPacks.map(renderCard).join("\n");
	const recentCards = recentPacks.map(renderCard).join("\n");
	const tagBadges = tags
		.map((t) => `<a class="tag-badge" href="/tag/${encodeURIComponent(t.tag)}">${escapeHtml(t.tag)}</a>`)
		.join("\n\t\t\t\t");

	return html(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Cat Nip — Community Music Visualizer Packs</title>
	<meta property="og:title" content="Cat Nip — Community Music Visualizer Packs" />
	<meta property="og:description" content="Browse and install community-contributed music visualizer packs for the Cat Nip desktop app." />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
	<style>${CSS}</style>
</head>
<body>
	<header>
		<h1>Cat Nip</h1>
		<p class="tagline">Community-contributed music visualizers</p>
		<p class="subtitle">Browse, discover, and install visualizer packs made by the community. ${totalCount} pack${totalCount !== 1 ? "s" : ""} and counting.</p>
		<nav>
			<a href="/search">Search packs</a>
			<a href="/search?sort=stars">Featured</a>
			<a href="/search?sort=installs">Most popular</a>
		</nav>
	</header>
	${
		tags.length > 0
			? `<section class="tags-section">
		<h3>Popular tags</h3>
		<div class="tags-row">
			${tagBadges}
		</div>
	</section>`
			: ""
	}
	${
		popularPacks.some((p) => p.install_count > 0)
			? `<section class="section">
		<div class="section-header">
			<h2>Most popular</h2>
			<a href="/search?sort=installs">View all</a>
		</div>
		<div class="grid">${popularCards}</div>
	</section>`
			: ""
	}
	${
		featuredPacks.length > 0
			? `<section class="section">
		<div class="section-header">
			<h2>Featured</h2>
			<a href="/search?sort=stars">View all</a>
		</div>
		<div class="grid">${featuredCards}</div>
	</section>`
			: ""
	}
	${
		recentPacks.length > 0
			? `<section class="section">
		<div class="section-header">
			<h2>Recently published</h2>
			<a href="/search">View all</a>
		</div>
		<div class="grid">${recentCards}</div>
	</section>`
			: `<section class="section">
		<p class="empty">No packs yet. Be the first to publish one.</p>
	</section>`
	}
	<footer>
		<p>Open-source on <a href="https://github.com/nperez0111/cat-nip">GitHub</a> under the MIT license.</p>
	</footer>
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
header {
	text-align: center;
	margin-bottom: 2.5rem;
	padding-bottom: 2rem;
	border-bottom: 1px solid #222;
}
header h1 {
	color: #ffd959;
	font-size: 2.5rem;
	margin-bottom: 0.25rem;
}
.tagline {
	color: #ccc;
	font-size: 1rem;
	margin-bottom: 0.5rem;
}
.subtitle {
	color: #666;
	font-size: 0.8rem;
	margin-bottom: 1.25rem;
	max-width: 500px;
	margin-left: auto;
	margin-right: auto;
	line-height: 1.5;
}
nav {
	display: flex;
	justify-content: center;
	gap: 1.5rem;
}
nav a {
	color: #ffd959;
	text-decoration: none;
	font-size: 0.875rem;
	font-weight: 700;
	padding: 0.5rem 1rem;
	border: 1px solid #ffd959;
	border-radius: 6px;
	transition: background 0.15s, color 0.15s;
}
nav a:hover {
	background: #ffd959;
	color: #000;
}
.tags-section {
	margin-bottom: 2rem;
	text-align: center;
}
.tags-section h3 {
	color: #888;
	font-size: 0.7rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	margin-bottom: 0.75rem;
}
.tags-row {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 0.5rem;
}
.tag-badge {
	display: inline-block;
	background: #111;
	color: #aaa;
	padding: 0.3em 0.75em;
	border-radius: 4px;
	font-size: 0.75rem;
	text-decoration: none;
	border: 1px solid #222;
	transition: border-color 0.15s, color 0.15s;
}
.tag-badge:hover {
	border-color: #ffd959;
	color: #ffd959;
}
.section {
	margin-bottom: 2.5rem;
}
.section-header {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	margin-bottom: 1rem;
}
.section-header h2 {
	color: #fff;
	font-size: 1.1rem;
}
.section-header a {
	color: #ffd959;
	text-decoration: none;
	font-size: 0.75rem;
}
.section-header a:hover {
	text-decoration: underline;
}
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
.card-stats {
	display: flex;
	gap: 0.75rem;
	align-items: center;
}
.stars {
	font-size: 0.75rem;
	color: #ffd959;
}
.stars::before {
	content: "\\2605 ";
}
.installs {
	font-size: 0.75rem;
	color: #aaa;
}
.installs::before {
	content: "\\2913 ";
}
.empty {
	color: #555;
	font-size: 0.875rem;
	text-align: center;
	padding: 2rem;
}
footer {
	margin-top: 3rem;
	padding-top: 1.5rem;
	border-top: 1px solid #222;
	text-align: center;
	font-size: 0.75rem;
	color: #555;
}
footer a {
	color: #888;
	text-decoration: none;
}
footer a:hover {
	color: #ffd959;
}
`;
