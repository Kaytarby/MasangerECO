# Эко-культура — мессенджер
# Собрать:  docker build -t ecoculture-messenger .
# Запустить: docker run -p 3000:3000 -v messenger-data:/data ecoculture-messenger

FROM node:22-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV DB_PATH=/data/eco_culture.db
ENV UPLOADS_DIR=/data/uploads
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/uploads
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
