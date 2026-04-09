FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public/ ./public/
COPY news/ ./news/
COPY notifications/ ./notifications/

EXPOSE 3000

CMD ["node", "server.js"]
