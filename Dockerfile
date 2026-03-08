FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY routes/ ./routes/
COPY config/ ./config/

RUN mkdir -p /app/logs

EXPOSE 3000

CMD ["node", "src/index.js"]
