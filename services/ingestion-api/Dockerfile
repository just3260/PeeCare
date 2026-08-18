FROM node:22-alpine AS build
WORKDIR /app
COPY contracts/device-events /app/contracts/device-events
COPY services/ingestion-api/package*.json ./services/ingestion-api/
WORKDIR /app/services/ingestion-api
RUN npm ci
COPY services/ingestion-api/tsconfig.json ./
COPY services/ingestion-api/src ./src
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY contracts/device-events/package*.json /app/contracts/device-events/
RUN npm --prefix /app/contracts/device-events ci --omit=dev
COPY contracts/device-events/lib /app/contracts/device-events/lib
COPY contracts/device-events/schemas /app/contracts/device-events/schemas
COPY services/ingestion-api/package*.json ./services/ingestion-api/
WORKDIR /app/services/ingestion-api
RUN npm ci --omit=dev
COPY --from=build /app/services/ingestion-api/dist ./dist
USER node
CMD ["node", "dist/server.js"]
