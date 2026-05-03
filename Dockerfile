# Headless visualizer-pack render in Linux. Produces a PNG without a window
# server using Mesa's lavapipe (CPU Vulkan ICD), so it works on any container
# host without GPU passthrough.
#
# Build:
#   docker build -t cat-nip-headless .
# Run:
#   mkdir -p docker-out
#   docker run --rm -v $PWD/docker-out:/out cat-nip-headless truchet-flow

FROM oven/bun:1.3.13-debian

# Mesa's lavapipe = CPU Vulkan ICD; libvulkan1 is the loader.
# libNativeWrapper.so is electrobun's GTK-only variant, so we need GTK + WebKit
# at dlopen time even though we never instantiate any windows or web views —
# the dynamic loader resolves DT_NEEDED entries eagerly. Same story for the
# xkb / wayland packages which Dawn links against.
RUN apt-get update && apt-get install -y --no-install-recommends \
		mesa-vulkan-drivers libvulkan1 \
		libgtk-3-0 libwebkit2gtk-4.1-0 libsoup-3.0-0 \
		libjavascriptcoregtk-4.1-0 libayatana-appindicator3-1 \
		libxkbcommon0 libgl1 libegl1 \
		libwayland-client0 libwayland-server0 \
		libxcb1 libx11-6 libxext6 \
		ca-certificates \
		gcc libc6-dev \
	&& rm -rf /var/lib/apt/lists/*

# Force Vulkan to use lavapipe (Mesa's CPU rasterizer). The container has no
# GPU and only the lvp ICD is functional; pinning here avoids the loader
# probing other ICDs that aren't backed by hardware.
ENV VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json

# electrobun's libs aren't built with $ORIGIN in their RUNPATH, so the dynamic
# loader can't find sibling .so files (libasar.so etc.) without help. Set the
# search path explicitly. We point it at both arches for safety.
ENV LD_LIBRARY_PATH=/app/node_modules/electrobun/dist-linux-arm64:/app/node_modules/electrobun/dist-linux-x64
ENV VIZ_BUNDLE_NATIVE_DIR=/app/node_modules/electrobun/dist-linux-arm64

WORKDIR /app

COPY package.json bun.lock tsconfig.json electrobun.config.ts ./
COPY src ./src
COPY scripts ./scripts

# audiocap is the macOS-only ScreenCaptureKit child process. The headless path
# never invokes it, but `electrobun.config.ts` declares it as a copy target so
# we drop a stub to let the bundler step succeed.
RUN mkdir -p src/native/audiocap && \
	printf '#!/bin/sh\nexit 1\n' > src/native/audiocap/audiocap && \
	chmod +x src/native/audiocap/audiocap

RUN bun install --frozen-lockfile

# `electrobun build` is the easiest way to make the CLI fetch its
# `dist-linux-<arch>/` payload (libwebgpu_dawn.so, libNativeWrapper.so, the
# bundled bun, etc.). We don't actually use the build output — Linux electrobun
# produces a self-extracting installer that's the wrong shape for direct use —
# so we discard it and run from `node_modules/electrobun/dist-linux-*` instead.
RUN bunx electrobun build --env=canary && rm -rf build

# Compile the by-pointer shim around wgpu's by-value-CallbackInfo APIs (see
# scripts/headless-shim.c for the why). On x86_64 SysV the `WGPUCallbackInfo`
# is passed in memory rather than via implicit indirect pointer, which bun:ffi
# can't model.
RUN DIST=$(ls -d node_modules/electrobun/dist-linux-* | head -1) && \
	gcc -shared -fPIC -O2 \
		-o "$DIST/libheadlessshim.so" \
		scripts/headless-shim.c \
		-L"$DIST" -lwebgpu_dawn \
		-Wl,-rpath,'$ORIGIN'

# Shim ../Resources/version.json relative to the dist dir. electrobun's
# BrowserView import does `Bun.file('../Resources/version.json').json()` at
# module load and crashes if it's missing. The script chdir's into
# `node_modules/electrobun/dist-linux-<arch>` before importing, so a single
# Resources dir at the parent satisfies it for any arch.
RUN mkdir -p node_modules/electrobun/Resources && \
	printf '{"version":"0.0.1","hash":"docker","channel":"canary","baseUrl":"","name":"cat-nip","identifier":"cat-nip.nickthesick.com"}\n' \
		> node_modules/electrobun/Resources/version.json

# Bind-mount target for the rendered PNG.
RUN mkdir -p /out

ENTRYPOINT ["bun", "scripts/render-pack.ts"]
CMD ["truchet-flow", "/out/truchet-flow.png"]
