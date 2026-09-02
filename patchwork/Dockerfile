FROM node:20-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js engine.js db.js patches.js timeTrack.js patchCircle.js ./
COPY --from=web-build /app/web/dist ./web/dist

EXPOSE 3000
CMD ["node", "server.js"]
