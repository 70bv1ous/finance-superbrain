FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 3099

# Start with tsx (no pre-compilation needed)
CMD ["npx", "tsx", "src/index.ts"]
