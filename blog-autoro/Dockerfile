FROM node:20-alpine
WORKDIR /app
COPY blog-autoro/package.json blog-autoro/package-lock.json* ./blog-autoro/
WORKDIR /app/blog-autoro
RUN npm install
WORKDIR /app
COPY blog-autoro ./blog-autoro
COPY scripts/blog-news ./scripts/blog-news
COPY config ./config
WORKDIR /app/blog-autoro
ENV BLOG_NEWS_ROOT=/app
ENV PORT=3002
RUN npm run build
EXPOSE 3002
CMD ["npm", "run", "start"]
