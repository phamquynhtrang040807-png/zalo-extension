FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app/zalo-bridge

COPY zalo-bridge/package.json zalo-bridge/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY zalo-bridge/server.mjs ./server.mjs

EXPOSE 3001
CMD ["node", "server.mjs"]
