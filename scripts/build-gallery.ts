#!/usr/bin/env bun
// Generates a static pack gallery site from manifests + pre-rendered PNGs.
//
// Usage:
//   bun run scripts/build-gallery.ts [--images=<dir>] [--out=<dir>]
//
// Defaults:
//   --images=tests/snapshots/packs   (where render.test.ts writes PNGs)
//   --out=site                       (gitignored output directory)

import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { computePackHashFromDir } from "../src/bun/packs/hash";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { imagesDir: string; outDir: string } {
	let imagesDir = "tests/snapshots/packs";
	let outDir = "site";
	for (const arg of process.argv.slice(2)) {
		if (arg.startsWith("--images=")) imagesDir = arg.slice("--images=".length);
		else if (arg.startsWith("--out=")) outDir = arg.slice("--out=".length);
		else {
			console.error(`Unknown arg: ${arg}`);
			process.exit(1);
		}
	}
	return { imagesDir, outDir };
}

// ---------------------------------------------------------------------------
// Pack manifest reading (no native deps -- just JSON.parse)
// ---------------------------------------------------------------------------

interface GalleryPack {
	slug: string;
	hash: string;
	name: string;
	version: string;
	author: string;
	description: string;
	tags: string[];
	tier: 1 | 2;
	parameterCount: number;
	parameterTypes: string[];
	presets: string[];
	hasPasses: boolean;
	passCount: number;
	audioFeatures: string[];
	image: string | null;
}

function readPacks(packsDir: string, imagesDir: string): GalleryPack[] {
	const slugs = readdirSync(packsDir)
		.filter((name) => {
			const p = join(packsDir, name, "manifest.json");
			try {
				return statSync(p).isFile();
			} catch {
				return false;
			}
		})
		.sort();

	const packs: GalleryPack[] = [];
	for (const slug of slugs) {
		const dir = join(packsDir, slug);
		const raw = readFileSync(join(dir, "manifest.json"), "utf-8");
		const m = JSON.parse(raw);

		const hash = computePackHashFromDir(dir);

		const imgPath = join(imagesDir, `${slug}.png`);
		const hasImage = existsSync(imgPath);

		packs.push({
			slug,
			hash,
			name: m.name ?? slug,
			version: m.version ?? "0.0.0",
			author: m.author ?? "",
			description: m.description ?? "",
			tags: Array.isArray(m.tags) ? m.tags : [],
			tier: m.wasm ? 2 : 1,
			parameterCount: Array.isArray(m.parameters) ? m.parameters.length : 0,
			parameterTypes: Array.isArray(m.parameters)
				? [...new Set(m.parameters.map((p: { type: string }) => p.type))]
				: [],
			presets: Array.isArray(m.presets) ? m.presets.map((p: { name: string }) => p.name) : [],
			hasPasses: Array.isArray(m.passes) && m.passes.length > 0,
			passCount: Array.isArray(m.passes) ? m.passes.length : 0,
			audioFeatures: m.audio?.features ?? [],
			image: hasImage ? `images/${slug}.png` : null,
		});
	}

	return packs;
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderCard(pack: GalleryPack): string {
	const imageHtml = pack.image
		? `<img src="${escapeHtml(pack.image)}" alt="${escapeHtml(pack.name)}" width="320" height="240" loading="lazy">`
		: `<div class="no-preview"><span>no preview</span></div>`;

	const descHtml = pack.description
		? `<p class="card-desc">${escapeHtml(pack.description)}</p>`
		: "";

	const metaParts: string[] = [];
	metaParts.push(`v${escapeHtml(pack.version)}`);
	if (pack.author) metaParts.push(escapeHtml(pack.author));

	const tagsHtml = pack.tags.length > 0
		? `<div class="card-tags">${pack.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
		: "";

	return `<article class="card" data-slug="${escapeHtml(pack.slug)}" data-name="${escapeHtml(pack.name.toLowerCase())}" data-desc="${escapeHtml(pack.description.toLowerCase())}" data-tags="${escapeHtml(pack.tags.join(","))}">
	<div class="card-image">${imageHtml}</div>
	<div class="card-body">
		<h2 class="card-title">${escapeHtml(pack.name)}</h2>
		${descHtml}
		<div class="card-meta">${metaParts.join(" &middot; ")}</div>
		${tagsHtml}
	</div>
</article>`;
}

function generateHtml(packs: GalleryPack[], generatedAt: string): string {
	const cards = packs.map(renderCard).join("\n");
	const count = packs.length;

	// Collect all unique tags, sorted alphabetically
	const allTags = [...new Set(packs.flatMap((p) => p.tags))].sort();
	const tagButtons = allTags
		.map((t) => `\t\t<button class="filter-btn" data-filter="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pack Gallery - music-visualizer</title>
<meta name="description" content="Browse ${count} visualizer packs for music-visualizer. Preview renders, parameters, and presets.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
<style>
/* ── Reset ───────────────────────────────────────────────── */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

/* ── Base ────────────────────────────────────────────────── */
:root {
	--bg: #000;
	--fg: #fff;
	--accent: #ffd959;
	--dim: rgba(255,255,255,0.5);
	--dimmer: rgba(255,255,255,0.4);
	--dimmest: rgba(255,255,255,0.3);
	--border: rgba(255,255,255,0.15);
	--border-hover: #fff;
	--font: 'Space Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
}

html { background: var(--bg); color: var(--fg); }

body {
	font-family: var(--font);
	font-size: 14px;
	line-height: 1.5;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

/* ── Header ──────────────────────────────────────────────── */
.header {
	padding: 3rem 2rem 1.5rem;
	max-width: 1400px;
	width: 100%;
	margin: 0 auto;
}

.header-top {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1rem;
	flex-wrap: wrap;
}

.title {
	font-size: 1.5rem;
	font-weight: 400;
	letter-spacing: 0.3em;
	text-transform: uppercase;
}

.pack-count {
	font-size: 0.85rem;
	color: var(--accent);
}

.subtitle {
	font-size: 0.85rem;
	color: var(--dim);
	margin-top: 0.25rem;
}

.header-line {
	border: none;
	border-top: 1px solid var(--fg);
	margin: 1rem 0 0;
	width: 16rem;
}

/* ── Toolbar ─────────────────────────────────────────────── */
.toolbar {
	padding: 1rem 2rem 1.5rem;
	max-width: 1400px;
	width: 100%;
	margin: 0 auto;
	display: flex;
	align-items: center;
	gap: 1.5rem;
	flex-wrap: wrap;
}

.search {
	background: var(--bg);
	border: 1px solid var(--border);
	color: var(--fg);
	font-family: var(--font);
	font-size: 0.8rem;
	padding: 0.4rem 0.6rem;
	width: 16rem;
	outline: none;
	transition: border-color 0.2s;
}
.search:focus {
	border-color: var(--fg);
}
.search::placeholder {
	color: var(--dimmest);
}

.filters {
	display: flex;
	gap: 0.25rem;
	flex-wrap: wrap;
}

.filter-btn {
	background: none;
	border: 1px solid transparent;
	color: var(--dim);
	font-family: var(--font);
	font-size: 0.75rem;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	padding: 0.3rem 0.6rem;
	cursor: pointer;
	transition: color 0.2s, border-color 0.2s;
}
.filter-btn:hover {
	color: var(--fg);
}
.filter-btn.active {
	color: var(--accent);
	border-color: var(--accent);
}

.result-count {
	font-size: 0.75rem;
	color: var(--dimmest);
	margin-left: auto;
}

/* ── Grid ────────────────────────────────────────────────── */
.grid {
	flex: 1;
	padding: 0 2rem 3rem;
	max-width: 1400px;
	width: 100%;
	margin: 0 auto;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 1px;
}

/* ── Card ────────────────────────────────────────────────── */
.card {
	border: 1px solid var(--border);
	transition: border-color 0.2s;
	display: flex;
	flex-direction: column;
}
.card:hover {
	border-color: var(--border-hover);
}
.card.hidden {
	display: none;
}

.card-image {
	aspect-ratio: 320 / 240;
	overflow: hidden;
	border-bottom: 1px solid var(--border);
}
.card-image img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

.no-preview {
	width: 100%;
	height: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	position: relative;
}
.no-preview::before,
.no-preview::after {
	content: '';
	position: absolute;
	background: var(--border);
}
.no-preview::before {
	width: 141.4%;
	height: 1px;
	transform: rotate(45deg);
}
.no-preview::after {
	width: 141.4%;
	height: 1px;
	transform: rotate(-45deg);
}
.no-preview span {
	position: relative;
	z-index: 1;
	font-size: 0.7rem;
	color: var(--dimmest);
	text-transform: uppercase;
	letter-spacing: 0.1em;
	background: var(--bg);
	padding: 0 0.5rem;
}

.card-body {
	padding: 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	flex: 1;
}

.card-title {
	font-size: 0.95rem;
	font-weight: 400;
	color: var(--fg);
}

.card-desc {
	font-size: 0.8rem;
	color: rgba(255,255,255,0.6);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	line-height: 1.4;
}

.card-meta {
	font-size: 0.7rem;
	color: var(--dimmer);
}

.card-tags {
	display: flex;
	gap: 0.35rem;
	flex-wrap: wrap;
	margin-top: auto;
	padding-top: 0.25rem;
}

.tag {
	font-size: 0.65rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--dim);
	border: 1px solid var(--dimmest);
	padding: 0.15rem 0.4rem;
	white-space: nowrap;
}

/* ── Footer ──────────────────────────────────────────────── */
.footer {
	padding: 2rem;
	max-width: 1400px;
	width: 100%;
	margin: 0 auto;
}

.footer-line {
	border: none;
	border-top: 1px solid var(--border);
	margin-bottom: 1rem;
}

.footer-text {
	font-size: 0.7rem;
	color: var(--dimmest);
}
.footer-text a {
	color: var(--dimmest);
	text-decoration: none;
	border-bottom: 1px solid var(--dimmest);
	transition: color 0.2s, border-color 0.2s;
}
.footer-text a:hover {
	color: var(--fg);
	border-color: var(--fg);
}

/* ── Responsive ──────────────────────────────────────────── */
@media (max-width: 640px) {
	.header { padding: 2rem 1rem 1rem; }
	.toolbar { padding: 0.75rem 1rem 1rem; }
	.grid { padding: 0 1rem 2rem; grid-template-columns: 1fr; }
	.footer { padding: 1.5rem 1rem; }
	.search { width: 100%; }
	.title { font-size: 1.1rem; letter-spacing: 0.2em; }
}
</style>
</head>
<body>

<header class="header">
	<div class="header-top">
		<h1 class="title">music visualizer</h1>
		<span class="pack-count">${count} packs</span>
	</div>
	<p class="subtitle">pack gallery</p>
	<hr class="header-line">
</header>

<nav class="toolbar">
	<input type="text" class="search" placeholder="search packs..." aria-label="Search packs">
	<div class="filters">
		<button class="filter-btn active" data-filter="all">all</button>
${tagButtons}
	</div>
	<span class="result-count" aria-live="polite"></span>
</nav>

<main class="grid">
${cards}
</main>

<footer class="footer">
	<hr class="footer-line">
	<p class="footer-text">
		generated ${escapeHtml(generatedAt)}
		&middot;
		<a href="https://github.com/nicholasgasior/music-visualizer">github</a>
	</p>
</footer>

<script>
(function() {
	const cards = document.querySelectorAll('.card');
	const search = document.querySelector('.search');
	const filterBtns = document.querySelectorAll('.filter-btn');
	const resultCount = document.querySelector('.result-count');

	let activeFilter = 'all';
	let query = '';

	function update() {
		let visible = 0;
		cards.forEach(function(card) {
			const name = card.dataset.name || '';
			const desc = card.dataset.desc || '';
			const slug = card.dataset.slug || '';
			const tags = (card.dataset.tags || '').split(',');

			// filter by tag
			let show = true;
			if (activeFilter !== 'all') {
				show = tags.indexOf(activeFilter) !== -1;
			}

			// search by name, description, slug, and tags
			if (show && query) {
				show = name.includes(query) || desc.includes(query) || slug.includes(query) || tags.some(function(t) { return t.includes(query); });
			}

			if (show) {
				card.classList.remove('hidden');
				visible++;
			} else {
				card.classList.add('hidden');
			}
		});

		resultCount.textContent = visible === cards.length ? '' : visible + ' of ' + cards.length;
	}

	search.addEventListener('input', function() {
		query = this.value.toLowerCase().trim();
		update();
	});

	filterBtns.forEach(function(btn) {
		btn.addEventListener('click', function() {
			filterBtns.forEach(function(b) { b.classList.remove('active'); });
			this.classList.add('active');
			activeFilter = this.dataset.filter;
			update();
		});
	});
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// packs.json generation
// ---------------------------------------------------------------------------

function generatePacksJson(packs: GalleryPack[], generatedAt: string): string {
	return JSON.stringify(
		{
			generatedAt,
			count: packs.length,
			packs: packs.map((p) => ({
				slug: p.slug,
				hash: p.hash,
				name: p.name,
				version: p.version,
				author: p.author,
				description: p.description,
				tags: p.tags,
				tier: p.tier,
				parameterCount: p.parameterCount,
				parameterTypes: p.parameterTypes,
				presets: p.presets,
				hasPasses: p.hasPasses,
				passCount: p.passCount,
				audioFeatures: p.audioFeatures,
				image: p.image,
			})),
		},
		null,
		"\t",
	);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { imagesDir, outDir } = parseArgs();
const PACKS_DIR = "src/packs";
const generatedAt = new Date().toISOString().split("T")[0]!;

console.log(`[build:gallery] reading packs from ${PACKS_DIR}`);
console.log(`[build:gallery] images from ${imagesDir}`);

const packs = readPacks(PACKS_DIR, imagesDir);
console.log(`[build:gallery] found ${packs.length} pack(s)`);

// Create output dirs
mkdirSync(join(outDir, "images"), { recursive: true });

// Copy images
let copied = 0;
for (const pack of packs) {
	if (pack.image) {
		const src = join(imagesDir, `${pack.slug}.png`);
		const dst = join(outDir, pack.image);
		copyFileSync(src, dst);
		copied++;
	}
}
console.log(`[build:gallery] copied ${copied} preview image(s)`);

// Write index.html
const html = generateHtml(packs, generatedAt);
Bun.write(join(outDir, "index.html"), html);

// Write packs.json
const json = generatePacksJson(packs, generatedAt);
Bun.write(join(outDir, "packs.json"), json);

console.log(`[build:gallery] wrote ${outDir}/index.html + ${outDir}/packs.json`);
console.log(`[build:gallery] OK`);
