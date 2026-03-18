FROM node:20-slim

WORKDIR /app

# Copy monorepo root files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy packages/schemas (api depends on it)
COPY packages/schemas/package.json ./packages/schemas/package.json
COPY packages/schemas/tsconfig.json ./packages/schemas/tsconfig.json
COPY packages/schemas/src ./packages/schemas/src

# Copy api package
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src

# Install all workspace deps from root
RUN npm install

ENV NODE_ENV=production
EXPOSE 3099

# Run with tsx - no pre-compilation needed
CMD ["node", "--import", "tsx/esm", "apps/api/src/index.ts"]
