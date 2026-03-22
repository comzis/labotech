# Stage 1: Build srt-live-transmit from source inside Debian Bookworm
# so the binary links against the same libstdc++ as the runtime container.
FROM debian:bookworm-slim AS srt-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git libssl-dev pkg-config ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.5.3 https://github.com/Haivision/srt.git /srt
RUN cmake -S /srt -B /srt/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DENABLE_SHARED=OFF \
      -DENABLE_APPS=ON \
      -DENABLE_ENCRYPTION=ON && \
    cmake --build /srt/build --target srt-live-transmit -j$(nproc) && \
    strip /srt/build/srt-live-transmit

# Stage 2: Build the frontend
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY web/package*.json ./web/
RUN npm install
RUN cd web && npm install && npm install framer-motion lucide-react clsx tailwind-merge
COPY . .
ARG LABOTECH_RELEASE
ENV LABOTECH_RELEASE=$LABOTECH_RELEASE
RUN cd web && npm run build

# Stage 3: Production runtime
FROM node:20-slim AS production
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      tcpdump \
      tshark \
      iproute2 \
      wget \
      curl \
      xz-utils && \
    # Install ffmpeg 7.x static build (John Van Sickle) — replaces Debian Bookworm's
    # ffmpeg 5.1.8 which does not emit periodic libsrt stats (msRTT, mbpsBandwidth etc.)
    # even with -loglevel verbose and statsintvl=N. ffmpeg 7.x fixed this.
    wget -qO /tmp/ffmpeg.tar.xz \
      https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp && \
    cp /tmp/ffmpeg-*-amd64-static/ffmpeg  /usr/local/bin/ffmpeg && \
    cp /tmp/ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg* && \
    ffmpeg -version | head -1 && \
    TSDUCK_DEB_URL="$(curl -fsSL https://api.github.com/repos/tsduck/tsduck/releases?per_page=40 | grep -o 'https://[^"]*tsduck_[^"]*debian12_amd64\.deb' | head -n1)" && \
    if [ -z "$TSDUCK_DEB_URL" ]; then \
      echo "Unable to resolve a Debian 12 TSDuck package from GitHub releases" >&2; \
      exit 1; \
    fi && \
    echo "Installing TSDuck from: $TSDUCK_DEB_URL" && \
    curl -fsSL "$TSDUCK_DEB_URL" -o /tmp/tsduck.deb && \
    apt-get install -y --no-install-recommends /tmp/tsduck.deb && \
    rm -f /tmp/tsduck.deb && \
    tsanalyze --version >/dev/null 2>&1 && \
    rm -rf /var/lib/apt/lists/*
# Copy srt-live-transmit built against Debian Bookworm libstdc++
COPY --from=srt-builder /srt/build/srt-live-transmit /usr/local/bin/srt-live-transmit
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src/ ./src/
COPY routes/ ./routes/
COPY config/ ./config/
# Grab the compiled frontend from Stage 2
COPY --from=builder /app/web/dist ./web/dist
RUN mkdir -p /app/logs
EXPOSE 4000
EXPOSE 4100
CMD ["node", "src/index.js"]

# Stage 4: Development — same runtime tools as production, but with devDependencies
# (nodemon). Source files are volume-mounted by docker-compose.dev.yml.
FROM production AS dev
RUN npm install
