FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY frontend ./frontend

USER node
EXPOSE 4000

CMD ["node", "src/server.js"]
