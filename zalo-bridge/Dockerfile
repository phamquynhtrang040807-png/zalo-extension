FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app/zalo-api-final

COPY zalo-api-final/package.json zalo-api-final/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY zalo-api-final/dist ./dist

WORKDIR /app/zalo-bridge
COPY zalo-bridge/server.mjs ./server.mjs

EXPOSE 3001
CMD ["node", "server.mjs"]
