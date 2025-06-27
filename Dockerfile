# Multi-stage build for minimal image size
FROM node:22-alpine AS builder

# Build argument for version
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
ARG VERSION=latest
ARG PORT=5005

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=${PORT}

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy version file
COPY --from=builder --chown=nodejs:nodejs /app/src/version.ts ./src/

# Copy configuration files (using correct name)
COPY --chown=nodejs:nodejs settings.json* ./

# Create presets directory
RUN mkdir -p presets

# Copy preset files only if not mounting external volume
# This allows the container to work with or without external presets
COPY --chown=nodejs:nodejs presets/*.json ./presets/ || true

# Create runtime directories with proper permissions
RUN mkdir -p /app/data /app/logs /app/tts-cache /app/music-library-cache && \
    chown -R nodejs:nodejs /app/data /app/logs /app/tts-cache /app/music-library-cache

# Add labels for better image metadata
LABEL org.opencontainers.image.source="https://git.bogometer.com/shartman/sonos-alexa-api"
LABEL org.opencontainers.image.description="Modern Sonos HTTP API for Alexa integration"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.authors="Shane Hartman <shartman@nx.bogometer.com>, Claude (Anthropic)"
LABEL org.opencontainers.image.licenses="MIT"

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