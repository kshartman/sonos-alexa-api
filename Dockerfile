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

# Install dumb-init for proper signal handling and curl for TTS
RUN apk add --no-cache dumb-init curl

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

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
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy version file
COPY --from=builder --chown=nodejs:nodejs /app/src/version.ts ./src/

# Copy default settings (renamed during copy)
COPY --chown=nodejs:nodejs settings.default.json ./settings.json

# Create presets directory
RUN mkdir -p presets

# Copy preset files if they exist (directory might be empty or contain only symlinks)
# Using a more robust approach to handle missing files
COPY --chown=nodejs:nodejs presets ./presets-tmp
RUN find ./presets-tmp -name "*.json" -type f -exec cp {} ./presets/ \; 2>/dev/null || true && \
    rm -rf ./presets-tmp

# Create runtime directories with proper permissions
RUN mkdir -p /app/data /app/logs /app/tts-cache /app/music-library-cache && \
    chown -R nodejs:nodejs /app/data /app/logs /app/tts-cache /app/music-library-cache

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
USER nodejs

# Expose port
EXPOSE ${PORT}

# Health check using dynamic port
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Include OpenSSL legacy provider flag for Pandora support
CMD ["node", "--openssl-legacy-provider", "dist/server.js"]