FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY server ./server
COPY worker ./worker
RUN pnpm build:server

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/dist/server.cjs ./server.cjs
RUN mkdir /app/data && chown node:node /app/data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O - http://127.0.0.1:8787/healthz >/dev/null || exit 1
USER node
CMD ["node", "server.cjs"]
