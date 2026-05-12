import { defineConfig } from "nitro";

const dataDir = process.env.CATNIP_DATA_DIR ?? ".data";

export default defineConfig({
	preset: "bun",
	serverDir: ".",
	storage: {
		previews: { driver: "fs", base: `${dataDir}/previews` },
		vizCache: { driver: "fs", base: `${dataDir}/viz-cache` },
	},
	routeRules: {
		"/api/**": {
			cors: true,
			headers: {
				"access-control-allow-methods": "GET, POST, OPTIONS",
				"access-control-allow-headers": "Content-Type",
			},
		},
		// Authenticated endpoints: disable wildcard CORS so browsers cannot
		// send cross-origin requests with Authorization headers.
		"/api/backfill": { cors: false },
		"/api/star": { cors: false },
	},
});
