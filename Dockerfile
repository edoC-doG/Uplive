# --- frontend build -------------------------------------------------------
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- backend build ----------------------------------------------------------
FROM node:20-slim AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

# --- runtime ----------------------------------------------------------------
# One process, one container = one Fargate task: NestJS serves both the API
# and the built React app, and is the only thing that spawns ffmpeg/yt-dlp.
FROM node:20-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=backend-build /app/backend/package*.json ./
RUN npm install --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

RUN mkdir -p /app/data
ENV DATA_DIR=/app/data
ENV PORT=3000
# Caps Node's V8 heap so it can't crowd out the memory ffmpeg needs for its
# own (non-V8) buffers inside the 1GB container budget.
ENV NODE_OPTIONS=--max-old-space-size=256

EXPOSE 3000
CMD ["node", "dist/main.js"]
