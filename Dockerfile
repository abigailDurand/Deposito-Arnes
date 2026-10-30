FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
# D15: el manifest conserva su ruta, que es el valor por defecto de MANIFEST_PATH.
COPY specs-v2/manifest.yaml ./specs-v2/manifest.yaml

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
