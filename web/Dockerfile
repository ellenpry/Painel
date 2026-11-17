# Contexto de build: raiz do repositório (o servidor usa src/Logica.gs, compartilhado com o Apps Script).
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/Logica.gs /app/src/Logica.gs
COPY web/server ./server
COPY web/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/saude || exit 1
CMD ["node", "server/index.js"]
