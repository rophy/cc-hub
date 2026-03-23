ARG BASE_IMAGE=ghcr.io/rophy/containers/claude:20260323-bc35380

FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/node-agent/package.json packages/node-agent/
RUN npm ci --workspace=packages/shared --workspace=packages/node-agent --include-workspace-root

COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/node-agent/src packages/node-agent/src
COPY packages/node-agent/tsconfig.json packages/node-agent/

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/node-agent

FROM ${BASE_IMAGE}

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/node-agent/package.json packages/node-agent/
RUN npm ci --workspace=packages/shared --workspace=packages/node-agent --include-workspace-root --omit=dev

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/node-agent/dist packages/node-agent/dist

CMD ["node", "packages/node-agent/dist/index.js"]
