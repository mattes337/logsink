FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install
RUN npm ci --only=production

# Copy source code
COPY . .

# Create logs directory
RUN mkdir -p logs
RUN mkdir -p images

# Expose port
EXPOSE 1234

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=1234
ENV API_KEY=your-secret-api-key

# Start the application
CMD ["npm", "start"]