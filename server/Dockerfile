FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
RUN npm ci --workspace=server --include-workspace-root=false
COPY server/ ./server/
RUN npm run build --workspace=server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
RUN npm ci --omit=dev --workspace=server --include-workspace-root=false
COPY --from=build /app/server/dist ./server/dist
EXPOSE 3001
CMD ["node", "server/dist/app.js"]
