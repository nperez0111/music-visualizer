import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "cat-nip",
		identifier: "cat-nip.nickthesick.com",
		version: "0.0.1",
		urlSchemes: ["catnip"],
	},
	build: {
		useAsar: false,
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"src/native/audiocap/audiocap": "audiocap",
			"src/packs": "packs",
			// `bun build` keeps the literal `new URL("./runtime-worker.ts", ...)`
			// reference, so the worker source must sit next to the bundled bun
			// entry (Resources/app/bun/index.js) at runtime.
			"src/bun/packs/runtime-worker.ts": "bun/runtime-worker.ts",
		},
		watchIgnore: [
			"src/native/audiocap/**",
		],
		mac: {
			bundleCEF: false,
			bundleWGPU: true,
			codesign: true,
			notarize: true,
			entitlements: {
				// Required for Bun's JIT compilation under hardened runtime
				"com.apple.security.cs.allow-jit": true,
				"com.apple.security.cs.allow-unsigned-executable-memory": true,
				"com.apple.security.cs.disable-library-validation": true,
			},
		},
		linux: {
			bundleCEF: false,
			bundleWGPU: true,
		},
		win: {
			bundleCEF: false,
			bundleWGPU: true,
		},
	},
} satisfies ElectrobunConfig;
