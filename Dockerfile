FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    FILAMENTBRIDGE_HOST=0.0.0.0 \
    FILAMENTBRIDGE_PORT=3000 \
    FILAMENTBRIDGE_DATABASE_PATH=/data/filamentbridge.sqlite \
    FILAMENTBRIDGE_KEY_DIR=/keys \
    FILAMENTBRIDGE_BACKUP_DIR=/backups \
    FILAMENTBRIDGE_WEB_DIST=/app/apps/web/dist \
    FILAMENTBRIDGE_PRINTER_CONNECTOR_ENABLED=true \
    FILAMENTBRIDGE_BAMBU_MQTT_INSECURE_TLS=false
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
EXPOSE 3000
VOLUME ["/data", "/keys", "/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.cjs"]
