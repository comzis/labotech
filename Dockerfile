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
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg tcpdump && \
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
CMD ["node", "src/index.js"]
