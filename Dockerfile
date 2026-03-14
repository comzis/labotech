# Stage 1: Build the frontend
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY web/package*.json ./web/
RUN npm install
RUN cd web && npm install && npm install framer-motion lucide-react clsx tailwind-merge
COPY . .
RUN cd web && npm run build

# Stage 2: Production runtime
FROM node:20-slim
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      ffmpeg \
      tcpdump \
      tshark \
      iproute2 \
      wget \
      curl && \
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
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src/ ./src/
COPY routes/ ./routes/
COPY config/ ./config/
# Grab the compiled frontend from Stage 1
COPY --from=builder /app/web/dist ./web/dist
RUN mkdir -p /app/logs
EXPOSE 4000
EXPOSE 4100
CMD ["node", "src/index.js"]
