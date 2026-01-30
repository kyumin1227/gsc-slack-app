# Stage 1: Build the application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install all dependencies, including devDependencies needed for the build
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Create the production image
FROM node:22-alpine

WORKDIR /app

# Copy package.json and package-lock.json again
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the build output from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the port the application runs on
EXPOSE 3000

# The command to start the application in production
CMD ["node", "dist/main"]
