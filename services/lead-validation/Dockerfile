# Minimal local-demo image for Lead Validation API (+ optional demo/ UI).
# Not production-hardened.
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3105

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY demo ./demo

EXPOSE 3105

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3105)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
