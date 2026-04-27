FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY packages/schemas/package.json ./packages/schemas/package.json
COPY packages/schemas/tsconfig.json ./packages/schemas/tsconfig.json

RUN npm ci

COPY apps/api/src ./apps/api/src
COPY apps/api/sql ./apps/api/sql
COPY packages/schemas/src ./packages/schemas/src

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/sql ./apps/api/sql
COPY --from=build /app/packages/schemas/package.json ./packages/schemas/package.json
COPY --from=build /app/packages/schemas/dist ./packages/schemas/dist

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
