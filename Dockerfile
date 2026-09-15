# TenderFlow API.
#
# Chromium is installed from the distribution rather than downloaded by
# Puppeteer. Two reasons: the bundled download frequently fails behind a
# corporate proxy or on a slim base image, and a distro build receives
# security updates with the rest of the image.

FROM node:22-slim AS base
ENV PUPPETEER_SKIP_DOWNLOAD=true

# ─── dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci needs dev dependencies: the server runs through tsx and the build
# step needs TypeScript.
RUN npm ci --ignore-scripts

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app

# Chromium plus the font and library set a headless browser needs to render
# the GeM portal. Without fonts, text extraction silently returns boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-cjk \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_HEADLESS=true \
    NODE_ENV=production \
    APP_ENV=production \
    PORT=3001

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY server ./server
COPY database.types.ts types.ts ./
COPY supabase ./supabase

# Chromium must not run as root, and neither should the API.
RUN useradd --create-home --shell /bin/bash tenderflow \
    && chown -R tenderflow:tenderflow /app
USER tenderflow

EXPOSE 3001

# dumb-init reaps the zombie processes a crashed Chromium leaves behind, and
# forwards SIGTERM so the server's graceful shutdown actually runs.
ENTRYPOINT ["dumb-init", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
