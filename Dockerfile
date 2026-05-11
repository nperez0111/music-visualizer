# CI headless render environment for visualizer packs.
#
# Used as the `container:` image by the render-packs GitHub Actions workflow.
# Contains all system deps needed to render packs via Mesa lavapipe (CPU
# Vulkan). Uses our extended headless-shim.c for wgpu buffer readback,
# eliminating the need for libNativeWrapper.so and its GTK/WebKit dependency
# tree. No GPU passthrough required.
#
# Pre-bakes: Mesa lavapipe, libwebgpu_dawn.so, libheadlessshim.so (with
# buffer readback), naga CLI, and the version.json shim so the CI workflow
# only needs: checkout → bun install → build:packs → run test.
#
# Published to GHCR by the docker-image workflow on changes to this file.
# See .github/workflows/docker-image.yml.

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build native libraries (GCC, electrobun build, shim compilation)
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3.13-debian AS native

RUN apt-get update && apt-get install -y --no-install-recommends \
		gcc libc6-dev \
		ca-certificates curl \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/electrobun-setup

# Copy only the files needed for bun install + electrobun build.
COPY package.json bun.lock ./
COPY packages/app/package.json ./packages/app/package.json
COPY packages/app/electrobun.config.ts ./packages/app/electrobun.config.ts
COPY packages/app/scripts/headless-shim.c ./packages/app/scripts/headless-shim.c
COPY packages/app/patches ./packages/app/patches
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
	DIST=$( (ls -d packages/app/node_modules/electrobun/dist-linux-* 2>/dev/null || \
	         ls -d node_modules/electrobun/dist-linux-* 2>/dev/null) | head -1) && \
	if [ -z "$DIST" ]; then echo "No electrobun dist dir found" && exit 1; fi && \
	# Compile the headless shim (includes buffer readback — no libNativeWrapper needed)
	gcc -shared -fPIC -O2 \
		-o "$DIST/libheadlessshim.so" \
		packages/app/scripts/headless-shim.c \
		-L"$DIST" -lwebgpu_dawn \
		-Wl,-rpath,'$ORIGIN' && \
	# Collect only the files we need into a clean output dir
	mkdir -p /opt/electrobun && \
	cp "$DIST/libwebgpu_dawn.so" /opt/electrobun/ && \
	cp "$DIST/libheadlessshim.so" /opt/electrobun/ && \
	# Create the version.json shim that electrobun reads at module load
	# (resolved as ../Resources/version.json relative to the native dir)
	mkdir -p /opt/Resources && \
	echo '{"version":"0.0.1","hash":"ci","channel":"canary","baseUrl":"","name":"cat-nip","identifier":"cat-nip.nickthesick.com"}' \
		> /opt/Resources/version.json

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime image — minimal system deps + pre-built artifacts
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3.13-debian

# Mesa lavapipe (CPU Vulkan) + Vulkan loader + libstdc++ (needed by libwebgpu_dawn)
# git is required by actions/checkout inside container jobs.
# After installing, remove perl (git dep only needed for git-svn/send-email,
# not for clone/checkout/commit) and man pages to save ~60 MB.
RUN apt-get update && apt-get install -y --no-install-recommends \
		mesa-vulkan-drivers libvulkan1 \
		git ca-certificates \
	&& dpkg --force-depends --remove perl perl-modules-5.40 libperl5.40 git-man \
	&& rm -rf /usr/share/perl5 /usr/share/perl /usr/lib/*/perl /usr/lib/*/perl5 \
	&& rm -rf /var/lib/apt/lists/*

# Copy pre-built native GPU libraries (only libwebgpu_dawn + headless shim)
COPY --from=native /opt/electrobun /opt/electrobun
COPY --from=native /opt/Resources /opt/Resources

# Copy naga binary (pre-built multi-arch image, see Dockerfile.naga + naga-image.yml)
COPY --from=ghcr.io/nperez0111/cat-nip-naga:29.0.0 /naga /usr/local/bin/naga

# ── Environment ──────────────────────────────────────────────────────────────
# Force Vulkan to use lavapipe (Mesa's CPU rasterizer).
ENV VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
# Point the render test at the pre-built native libs.
ENV VIZ_BUNDLE_NATIVE_DIR=/opt/electrobun
ENV LD_LIBRARY_PATH=/opt/electrobun

WORKDIR /app
