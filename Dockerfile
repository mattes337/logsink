FROM node:18-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create data and images directories with proper permissions
RUN mkdir -p data images && \
    chown -R node:node data images

# Switch to non-root user
USER node

# Expose port
EXPOSE 1234

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=1234

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:1234/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["npm", "start"]