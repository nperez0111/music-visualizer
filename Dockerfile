# CI headless render environment for visualizer packs.
#
# Used as the `container:` image by the render-packs GitHub Actions workflow.
# Contains all system deps needed to render packs via Mesa lavapipe (CPU
# Vulkan), including GTK/WebKit runtime libs that electrobun's native wrapper
# eagerly resolves at dlopen time. No GPU passthrough required.
#
# Pre-bakes the electrobun native libraries, the wgpu ABI shim, and the
# version.json shim so the CI workflow only needs: checkout → bun install →
# build:packs → run test. No compilation or electrobun build at CI time.
#
# Published to GHCR by the docker-image workflow on changes to this file.
# See .github/workflows/docker-image.yml.

FROM oven/bun:1.3.13-debian

# ── System packages ──────────────────────────────────────────────────────────
# Mesa lavapipe  = CPU Vulkan ICD (no GPU needed)
# GTK/WebKit     = electrobun's libNativeWrapper.so eagerly resolves these
# GCC            = compile the wgpu by-value-CallbackInfo shim
# curl           = fetch rustup installer
# git            = needed by actions/checkout inside container jobs
RUN apt-get update && apt-get install -y --no-install-recommends \
		mesa-vulkan-drivers libvulkan1 \
		libgtk-3-0 libwebkit2gtk-4.1-0 libsoup-3.0-0 \
		libjavascriptcoregtk-4.1-0 libayatana-appindicator3-1 \
		libxkbcommon0 libgl1 libegl1 \
		libwayland-client0 libwayland-server0 \
		libxcb1 libx11-6 libxext6 \
		ca-certificates curl git \
		gcc libc6-dev \
	&& rm -rf /var/lib/apt/lists/*

# ── Rust + naga-cli ──────────────────────────────────────────────────────────
# naga-cli transpiles GLSL → WGSL for GLSL packs. cargo-binstall may not have
# a prebuilt binary for every arch (e.g. aarch64-linux), so we install the
# full Rust toolchain and compile from source as a fallback.
ENV RUSTUP_HOME="/usr/local/rustup" \
	CARGO_HOME="/usr/local/cargo" \
	PATH="/usr/local/cargo/bin:${PATH}"

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
		| sh -s -- -y --profile minimal --default-toolchain stable && \
	cargo install naga-cli && \
	# Strip debug symbols to save ~100 MB
	strip /usr/local/cargo/bin/naga && \
	# Drop everything except the naga binary — rustc/cargo aren't needed at
	# runtime and the toolchain adds ~500 MB to the image layer.
	cp /usr/local/cargo/bin/naga /usr/local/bin/naga && \
	rustup self uninstall -y && \
	rm -rf /usr/local/cargo /usr/local/rustup

# ── Electrobun native libs ───────────────────────────────────────────────────
# We run `bunx electrobun build` solely to populate the dist-linux-x64/
# directory with bun + libwebgpu_dawn.so + libNativeWrapper.so. The build
# output itself (a self-extracting installer) is discarded.
#
# To make electrobun build succeed we need a minimal project: package.json,
# bun.lock, electrobun.config.ts, and stubs for every path in `copy:`.
WORKDIR /tmp/electrobun-setup

# Copy only the files needed for bun install + electrobun build.
# These rarely change, so this layer is well-cached.
COPY package.json bun.lock ./
COPY packages/app/package.json ./packages/app/package.json
COPY packages/app/electrobun.config.ts ./packages/app/electrobun.config.ts
COPY packages/app/scripts/headless-shim.c ./packages/app/scripts/headless-shim.c
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/lexicons/package.json ./packages/lexicons/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/server/package.json ./packages/server/package.json

# Create stubs for everything electrobun.config.ts copy: references.
RUN mkdir -p packages/app/src/native/audiocap packages/app/src/packs \
		packages/app/src/mainview packages/app/src/bun/packs && \
	printf '#!/bin/sh\nexit 1\n' > packages/app/src/native/audiocap/audiocap && \
	chmod +x packages/app/src/native/audiocap/audiocap && \
	touch packages/app/src/mainview/index.html packages/app/src/mainview/index.css && \
	touch packages/app/src/mainview/index.ts packages/app/src/bun/index.ts && \
	touch packages/app/src/bun/packs/runtime-worker.ts

# Install deps, run electrobun build to fetch native libs, compile shim.
RUN bun install --frozen-lockfile && \
	(cd packages/app && bunx electrobun build --env=canary || true) && \
	# Find the dist dir (arch varies: x64 in CI, arm64 on Apple Silicon host)
	DIST=$(ls -d node_modules/electrobun/dist-linux-* 2>/dev/null | head -1) && \
	if [ -z "$DIST" ]; then echo "No electrobun dist dir found" && exit 1; fi && \
	# Compile the headless wgpu ABI shim
	gcc -shared -fPIC -O2 \
		-o "$DIST/libheadlessshim.so" \
		packages/app/scripts/headless-shim.c \
		-L"$DIST" -lwebgpu_dawn \
		-Wl,-rpath,'$ORIGIN' && \
	# Move native libs to a fixed well-known path
	mkdir -p /opt/electrobun && \
	cp -a "$DIST"/. /opt/electrobun/ && \
	# Create the version.json shim that electrobun reads at module load
	# (resolved as ../Resources/version.json relative to the native dir)
	mkdir -p /opt/Resources && \
	echo '{"version":"0.0.1","hash":"ci","channel":"canary","baseUrl":"","name":"cat-nip","identifier":"cat-nip.nickthesick.com"}' \
		> /opt/Resources/version.json && \
	# Clean up the entire setup directory
	rm -rf /tmp/electrobun-setup

# ── Environment ──────────────────────────────────────────────────────────────
# Force Vulkan to use lavapipe (Mesa's CPU rasterizer).
ENV VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
# Point the render test at the pre-built native libs.
ENV VIZ_BUNDLE_NATIVE_DIR=/opt/electrobun
ENV LD_LIBRARY_PATH=/opt/electrobun

WORKDIR /app
