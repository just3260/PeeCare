FROM node:22-alpine AS build

WORKDIR /app/services/test-tool-api
COPY services/test-tool-api/package*.json ./
RUN npm ci --omit=optional
COPY services/test-tool-api/tsconfig.json ./
COPY services/test-tool-api/src ./src
RUN npm run build

FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="PeeCare Development Test Tool API" \
      com.peecare.cloud-run.billing="request-based" \
      com.peecare.cloud-run.minimum-instances="0" \
      com.peecare.cloud-run.maximum-instances="2" \
      com.peecare.cloud-run.concurrency="20" \
      com.peecare.cloud-run.dedicated-runtime-identity="required"

WORKDIR /app/services/test-tool-api
ENV NODE_ENV=production
COPY services/test-tool-api/package*.json ./
RUN npm ci --omit=dev --omit=optional
COPY --from=build /app/services/test-tool-api/dist ./dist

USER node
CMD ["node", "dist/server.js"]
