# Multi-stage build for minimal image size
FROM node:22-alpine AS builder

# Build arguments for metadata
ARG BUILD_DATE
ARG BUILD_SOURCE_DATE
ARG VCS_REF
ARG VERSION=latest

WORKDIR /app

# Copy package files
COPY package*.json tsconfig.json ./

# Install all dependencies (including dev for building)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Generate version.ts file
RUN npm run save-version

# Production stage
FROM node:22-alpine

# Build arguments
ARG BUILD_DATE
ARG BUILD_SOURCE_DATE
ARG VCS_REF
ARG VERSION=latest
ARG PORT=5005
ARG APP_UID=1000
ARG APP_GID=1000

# Install dumb-init for proper signal handling and curl for TTS
RUN apk add --no-cache dumb-init curl

# Create non-root user (reuses the base image account when the ids already exist)
RUN if ! getent group ${APP_GID} > /dev/null; then addgroup -g ${APP_GID} -S sonos; fi && \
    if ! getent passwd ${APP_UID} > /dev/null; then \
        adduser -S -u ${APP_UID} -G "$(getent group ${APP_GID} | cut -d: -f1)" sonos; \
    fi

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=${PORT}
ENV BUILD_SOURCE_DATE=${BUILD_SOURCE_DATE}

# Copy package files and install production dependencies
COPY package*.json ./
# Install production dependencies, explicitly excluding optional dependencies
RUN npm ci --only=production --no-optional && npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=${APP_UID}:${APP_GID} /app/dist ./dist

# Copy version file
COPY --from=builder --chown=${APP_UID}:${APP_GID} /app/src/version.ts ./src/

# Copy default settings (renamed during copy)
COPY --chown=${APP_UID}:${APP_GID} settings.default.json ./settings.json

# Create presets directory
RUN mkdir -p presets

# Copy preset files if they exist (directory might be empty or contain only symlinks)
# Using a more robust approach to handle missing files
COPY --chown=${APP_UID}:${APP_GID} presets ./presets-tmp
RUN find ./presets-tmp -name "*.json" -type f -exec cp {} ./presets/ \; 2>/dev/null || true && \
    rm -rf ./presets-tmp

# Create runtime directories with proper permissions
RUN mkdir -p /app/data /app/logs && \
    chown -R ${APP_UID}:${APP_GID} /app/data /app/logs

# Add OCI labels for better image metadata
LABEL org.opencontainers.image.created=$BUILD_DATE
LABEL org.opencontainers.image.url="https://github.com/kshartman/sonos-alexa-api"
LABEL org.opencontainers.image.source="https://github.com/kshartman/sonos-alexa-api"
LABEL org.opencontainers.image.documentation="https://github.com/kshartman/sonos-alexa-api/blob/main/README.md"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.revision=$VCS_REF
LABEL org.opencontainers.image.vendor="Shane Hartman"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="Sonos Alexa API"
LABEL org.opencontainers.image.description="Modern TypeScript Sonos HTTP API for Alexa integration with minimal dependencies"
LABEL org.opencontainers.image.authors="Shane Hartman, Claude (Anthropic)"

# Switch to non-root user
USER ${APP_UID}:${APP_GID}

# Expose port
EXPOSE ${PORT}

# Health check using dynamic port
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Include OpenSSL legacy provider flag for Pandora support
CMD ["node", "--openssl-legacy-provider", "dist/server.js"]