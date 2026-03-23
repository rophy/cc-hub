FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
# Only need shared and server for the build
RUN npm ci --workspace=packages/shared --workspace=packages/server --include-workspace-root

COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/server/src packages/server/src
COPY packages/server/tsconfig.json packages/server/

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/server

FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN npm ci --workspace=packages/shared --workspace=packages/server --include-workspace-root --omit=dev

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/server/dist packages/server/dist

ENV CC_HUB_WS_PORT=3000
EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
