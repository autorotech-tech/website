FROM node:18-alpine

RUN apk add --no-cache ca-certificates poppler-utils

WORKDIR /app
COPY indexer.mjs /app/indexer.mjs
COPY pdfMarkdown.mjs /app/pdfMarkdown.mjs

ENV NODE_ENV=production

CMD ["node", "/app/indexer.mjs"]


