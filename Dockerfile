FROM node:22.23-alpine3.24@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY server ./server
COPY worker ./worker
COPY shared ./shared
RUN pnpm build:server

FROM node:22.23-alpine3.24@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/dist/server.cjs ./server.cjs
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O - http://127.0.0.1:8787/healthz >/dev/null || exit 1
USER node
CMD ["node", "server.cjs"]
