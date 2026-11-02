FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# SPEC-02 §1: Express 4.21 (versión exacta de SPEC-00).
RUN npm install --save-exact --omit=dev express@4.21.2 && npm cache clean --force

COPY server.js ./

USER node
EXPOSE 4000
CMD ["node", "server.js"]
