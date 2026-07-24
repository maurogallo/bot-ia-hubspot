FROM node:20-slim

# Install system Chromium (puppeteer-bundled Chrome for ARM64 is broken)
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROMIUM_PATH=/usr/bin/chromium
RUN apt-get update && apt-get install -y chromium --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .

EXPOSE 3090

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
