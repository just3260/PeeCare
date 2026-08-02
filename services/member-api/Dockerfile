FROM node:22-alpine AS build

WORKDIR /app/services/member-api
COPY services/member-api/package*.json ./
RUN npm ci --omit=optional
COPY services/member-api/tsconfig.json ./
COPY services/member-api/src ./src
RUN npm run build

FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="PeeCare Member API" \
      com.peecare.cloud-run.billing="request-based" \
      com.peecare.cloud-run.minimum-instances="0" \
      com.peecare.cloud-run.dedicated-runtime-identity="required" \
      com.peecare.cloud-run.location-policy="firestore-compatible"

WORKDIR /app/services/member-api
ENV NODE_ENV=production
COPY services/member-api/package*.json ./
RUN npm ci --omit=dev --omit=optional
COPY --from=build /app/services/member-api/dist ./dist

USER node
CMD ["node", "dist/server.js"]
