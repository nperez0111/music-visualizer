import { defineConfig } from "nitro";

const dataDir = process.env.CATNIP_DATA_DIR ?? ".data";

export default defineConfig({
	preset: "bun",
	serverDir: ".",
	storage: {
		previews: { driver: "fs", base: `${dataDir}/previews` },
		vizCache: { driver: "fs", base: `${dataDir}/viz-cache` },
	},
});
