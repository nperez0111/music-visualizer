/**
 * GET /search
 *
 * SSR search page. Server-side search, tag filtering, and sort.
 * Query params: ?q= (search text), ?tag= (tag filter), ?sort=newest|stars
 */

import { defineHandler, html } from "nitro";
import { getQuery } from "nitro/h3";
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

export default defineHandler(async (event) => {
	const db = getDb();
	const query = getQuery(event);

	const search = ((query.q as string) ?? "").trim();
	const tag = ((query.tag as string) ?? "").trim();
	const sortParam = query.sort as string;
	const sort = sortParam === "stars" ? "stars" : sortParam === "installs" ? "installs" : "newest";
	const PAGE_SIZE = 75;
	const page = Math.max(1, parseInt(query.page as string) || 1);
	const offset = (page - 1) * PAGE_SIZE;

	// Build SQL dynamically (same pattern as api/packs.ts)
	let sql = `
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
	`;

	const params: any[] = [];

	if (search) {
		sql += " AND (r.name LIKE ? OR r.description LIKE ? OR r.slug LIKE ?)";
		const like = `%${search}%`;
		params.push(like, like, like);
	}

	if (tag) {
		sql += `
			AND EXISTS (
				SELECT 1 FROM tags t
				JOIN versions v ON v.did = t.version_did AND v.rkey = t.version_rkey
				WHERE v.release_did = r.did AND v.release_rkey = r.rkey AND t.tag = ?
			)
		`;
		params.push(tag);
	}

	// Count total matching results for pagination
	const countSql = `SELECT COUNT(*) as total FROM releases r WHERE r.hidden = 0`
		+ (search ? " AND (r.name LIKE ? OR r.description LIKE ? OR r.slug LIKE ?)" : "")
		+ (tag ? ` AND EXISTS (
			SELECT 1 FROM tags t
			JOIN versions v ON v.did = t.version_did AND v.rkey = t.version_rkey
			WHERE v.release_did = r.did AND v.release_rkey = r.rkey AND t.tag = ?
		)` : "");
	const countParams: any[] = [];
	if (search) { const like = `%${search}%`; countParams.push(like, like, like); }
	if (tag) { countParams.push(tag); }
	const { total } = db.prepare(countSql).get(...countParams) as { total: number };
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	if (sort === "stars") {
		sql += " ORDER BY star_count DESC, r.created_at DESC";
	} else if (sort === "installs") {
		sql += " ORDER BY install_count DESC, r.created_at DESC";
	} else {
		sql += " ORDER BY r.created_at DESC";
	}

	sql += " LIMIT ? OFFSET ?";
	params.push(PAGE_SIZE, offset);

	const packs = db.prepare(sql).all(...params) as PackRow[];

	// Resolve DIDs to handles
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

	// Get all tags for the sidebar
	const allTags = getAllTags(db);

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
				<div class="card-stats">
					<span class="stars">${p.star_count}</span>
					<span class="installs">${p.install_count}</span>
				</div>
			</div>
		</div>
	`,
		)
		.join("\n");

	const tagLinks = allTags
		.map(
			(t) =>
				`<a class="tag-link${tag === t.tag ? " active" : ""}" href="/search?tag=${encodeURIComponent(t.tag)}${search ? `&q=${encodeURIComponent(search)}` : ""}${sort !== "newest" ? `&sort=${sort}` : ""}">${escapeHtml(t.tag)} <span class="tag-count">${t.count}</span></a>`,
		)
		.join("\n\t\t\t\t");

	const resultSummary = search || tag
		? `${total} result${total !== 1 ? "s" : ""}${search ? ` for "${escapeHtml(search)}"` : ""}${tag ? ` tagged "${escapeHtml(tag)}"` : ""}${totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}`
		: `${total} pack${total !== 1 ? "s" : ""}${totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}`;

	// Build pagination URL helper
	const paginationUrl = (p: number) => {
		const parts: string[] = [];
		if (search) parts.push(`q=${encodeURIComponent(search)}`);
		if (tag) parts.push(`tag=${encodeURIComponent(tag)}`);
		if (sort !== "newest") parts.push(`sort=${sort}`);
		if (p > 1) parts.push(`page=${p}`);
		return `/search${parts.length ? "?" + parts.join("&") : ""}`;
	};

	return html(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Search — Cat Nip</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
	<style>${CSS}</style>
</head>
<body>
	<header>
		<a href="/" class="back">Cat Nip</a>
	</header>
	<main>
		<div class="search-header">
			<h1>Search Packs</h1>
			<form class="search-form" method="get" action="/search">
				<input type="text" name="q" placeholder="Search by name, description, or slug..." value="${escapeHtml(search)}" autocomplete="off" />
				${tag ? `<input type="hidden" name="tag" value="${escapeHtml(tag)}" />` : ""}
				<select name="sort">
					<option value="newest"${sort === "newest" ? " selected" : ""}>Newest</option>
					<option value="stars"${sort === "stars" ? " selected" : ""}>Most starred</option>
					<option value="installs"${sort === "installs" ? " selected" : ""}>Most popular</option>
				</select>
				<button type="submit">Search</button>
			</form>
		</div>
		<div class="content">
			<aside class="sidebar">
				<h3>Tags</h3>
				${tag ? `<a class="tag-link clear" href="/search${search ? `?q=${encodeURIComponent(search)}` : ""}${sort !== "newest" ? `${search ? "&" : "?"}sort=${sort}` : ""}">All tags</a>` : ""}
				${tagLinks || "<p class='empty'>No tags yet.</p>"}
			</aside>
			<div class="results">
				<p class="result-summary">${resultSummary}</p>
				<div class="grid">
					${packCards || "<p class='empty'>No packs found.</p>"}
				</div>
				${totalPages > 1 ? `
				<nav class="pagination">
					${page > 1 ? `<a class="page-link" href="${paginationUrl(page - 1)}">Previous</a>` : `<span class="page-link disabled">Previous</span>`}
					${page < totalPages ? `<a class="page-link" href="${paginationUrl(page + 1)}">Next</a>` : `<span class="page-link disabled">Next</span>`}
				</nav>
				` : ""}
			</div>
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
.search-header {
	margin-bottom: 2rem;
}
.search-header h1 {
	color: #ffd959;
	font-size: 1.5rem;
	margin-bottom: 1rem;
}
.search-form {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
}
.search-form input[type="text"] {
	flex: 1;
	min-width: 200px;
	padding: 0.6rem 1rem;
	background: #111;
	border: 1px solid #333;
	border-radius: 6px;
	color: #fff;
	font-family: 'Space Mono', monospace;
	font-size: 0.875rem;
}
.search-form input[type="text"]:focus {
	outline: none;
	border-color: #ffd959;
}
.search-form select {
	padding: 0.6rem 0.75rem;
	background: #111;
	border: 1px solid #333;
	border-radius: 6px;
	color: #fff;
	font-family: 'Space Mono', monospace;
	font-size: 0.875rem;
}
.search-form button {
	padding: 0.6rem 1.25rem;
	background: #ffd959;
	color: #000;
	border: none;
	border-radius: 6px;
	font-family: 'Space Mono', monospace;
	font-weight: 700;
	font-size: 0.875rem;
	cursor: pointer;
}
.search-form button:hover {
	background: #ffe680;
}
.content {
	display: grid;
	grid-template-columns: 200px 1fr;
	gap: 2rem;
}
@media (max-width: 768px) {
	.content { grid-template-columns: 1fr; }
}
.sidebar h3 {
	color: #888;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	margin-bottom: 0.75rem;
}
.tag-link {
	display: block;
	padding: 0.35rem 0;
	color: #aaa;
	text-decoration: none;
	font-size: 0.8rem;
	transition: color 0.15s;
}
.tag-link:hover {
	color: #ffd959;
}
.tag-link.active {
	color: #ffd959;
	font-weight: 700;
}
.tag-link.clear {
	color: #666;
	font-size: 0.75rem;
	margin-bottom: 0.5rem;
	padding-bottom: 0.5rem;
	border-bottom: 1px solid #222;
}
.tag-count {
	color: #555;
	font-size: 0.7rem;
}
.result-summary {
	color: #666;
	font-size: 0.8rem;
	margin-bottom: 1rem;
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
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
}
.pagination {
	display: flex;
	justify-content: center;
	gap: 1rem;
	margin-top: 2rem;
	padding-top: 1.5rem;
	border-top: 1px solid #222;
}
.page-link {
	padding: 0.5rem 1.25rem;
	background: #111;
	border: 1px solid #333;
	border-radius: 6px;
	color: #fff;
	text-decoration: none;
	font-family: 'Space Mono', monospace;
	font-size: 0.8rem;
	transition: border-color 0.15s, color 0.15s;
}
.page-link:hover:not(.disabled) {
	border-color: #ffd959;
	color: #ffd959;
}
.page-link.disabled {
	color: #444;
	border-color: #1a1a1a;
	cursor: default;
}
`;
