FROM node:22-slim

# Install pnpm 10 (matches workspace lockfile version)
RUN npm install -g pnpm@10

WORKDIR /app

# Copy everything
COPY . .

# Install all workspace dependencies
RUN pnpm install --no-frozen-lockfile

# Build the API server bundle
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production

# Push DB schema then start the server.
# push-force runs at container start so DATABASE_URL is guaranteed to be
# available (Railway injects runtime env vars before CMD).
CMD sh -c "pnpm --filter @workspace/db run push-force && node --enable-source-maps artifacts/api-server/dist/index.mjs"
