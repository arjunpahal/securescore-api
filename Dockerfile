# =============================================================================
# SecureScore API — multi-stage Docker image
# Stage 1: deps   — installs production dependencies only
# Stage 2: runner — non-root, minimal runtime image
# =============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ARG BUILD_VERSION=dev
ARG BUILD_NUMBER=0
ARG GIT_COMMIT=unknown

ENV NODE_ENV=production \
    PORT=3000 \
    BUILD_VERSION=${BUILD_VERSION} \
    BUILD_NUMBER=${BUILD_NUMBER} \
    GIT_COMMIT=${GIT_COMMIT}

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
