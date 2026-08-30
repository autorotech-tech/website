FROM node:18-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY telegram ./telegram
RUN npm install && npx tsc

FROM node:18-alpine
WORKDIR /app
COPY package.json /app/package.json
COPY server.mjs /app/server.mjs
COPY --from=build /app/telegram/dist /app/telegram/dist
ENV PORT=8080
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
