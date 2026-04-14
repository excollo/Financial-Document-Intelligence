# Use Node.js 20 base image
FROM node:20-alpine AS builder

WORKDIR /app

# Install system dependencies for build
RUN apk add --no-cache libc6-compat

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS node-backend

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --only=production

# Copy built assets
COPY --from=builder /app/dist ./dist

# Expose the API port
EXPOSE 5000

# Start command
CMD ["npm", "start"]
