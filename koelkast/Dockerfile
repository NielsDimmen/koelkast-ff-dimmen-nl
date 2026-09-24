FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /src
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM ghcr.io/home-assistant/base:3.24

RUN apk add --no-cache libstdc++
COPY --from=node:22-alpine /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY --from=server /src/package.json ./server/package.json
COPY --from=server /src/node_modules ./server/node_modules
COPY --from=server /src/dist ./server/dist
COPY --from=web /src/dist ./web/dist
COPY run.sh /etc/services.d/koelkast/run
RUN chmod a+x /etc/services.d/koelkast/run

ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    PORT=8099 \
    INGRESS_PORT=8098

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s \
  CMD node -e "fetch('http://127.0.0.1:8099/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
