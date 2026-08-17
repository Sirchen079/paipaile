# ---- 构建前端 ----
FROM node:20-alpine AS web-build
WORKDIR /app
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- 运行时 ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY shared/ ./shared/
COPY server/ ./server/
COPY --from=web-build /app/dist ./web/dist
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
