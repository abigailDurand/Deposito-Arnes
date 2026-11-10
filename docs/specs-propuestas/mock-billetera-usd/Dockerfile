FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN npm install --save-exact --omit=dev express@4.21.2 && npm cache clean --force

COPY server.js ./

USER node
EXPOSE 4100
CMD ["node", "server.js"]
