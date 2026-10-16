FROM node:22-slim

# Install pnpm 10 (matches workspace lockfile version)
RUN npm install -g pnpm@10

WORKDIR /app

# Copy everything
COPY . .

# Install all workspace dependencies
RUN pnpm install --no-frozen-lockfile

# Fail if the API package is missing/misnamed or the entry bundle is not produced.
RUN pnpm --fail-if-no-match --filter @workspace/api-server run build \
    && test -s artifacts/api-server/dist/index.mjs

ENV NODE_ENV=production

# Normal deploys and restarts only start the API. Schema changes require a
# separate, explicitly approved operation; see RAILWAY_SETUP.md.
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
