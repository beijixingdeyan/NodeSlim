FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
# Pre-build web if deps available (optional)
RUN npm --prefix web install --silent || echo "web deps skip" && npm --prefix web run build || echo "web build skipped"

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/rules ./rules
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/.nodeslimrc.json ./.nodeslimrc.json
EXPOSE 3000
CMD ["node", "src/server/index.js"]
