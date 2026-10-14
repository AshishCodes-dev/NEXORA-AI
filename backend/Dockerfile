# ==============================================================================
# NEXORA AI — Production Backend Dockerfile
# ==============================================================================
# Multi-agent autonomous OS backend container with Playwright Chromium support.
#
# Base: Node.js 22 LTS (Bookworm Slim)
# Features:
# - System libraries required for headless Playwright Chromium execution
# - Non-root process execution under user 'nexora'
# - Native Docker health checks via GET /api/health
# ==============================================================================

FROM node:22-bookworm-slim

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=5000

# Set working directory
WORKDIR /app

# Install native system dependencies required by Playwright Chromium and curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# Copy package definitions first for optimal layer caching
COPY backend/package*.json ./

# Install production dependencies and download Chromium headless browser binary
RUN npm ci --omit=dev && npx playwright install chromium

# Copy backend application source code
COPY backend/ ./

# Create unprivileged system user for secure container operation
RUN groupadd -r nexora && useradd -r -g nexora -d /app nexora \
    && chown -R nexora:nexora /app

# Switch to non-root user
USER nexora

# Expose backend API port
EXPOSE 5000

# Container healthcheck using backend /api/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

# Start NEXORA backend server
CMD ["node", "server.js"]
