FROM node:20-slim

WORKDIR /app

COPY package.json .

COPY server.js engine.js ./
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]
