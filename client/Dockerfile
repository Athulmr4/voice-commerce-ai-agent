FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY client/package.json ./client/
RUN npm ci --workspace=client --include-workspace-root=false
COPY client/ ./client/
RUN npm run build --workspace=client

FROM nginx:alpine
COPY --from=build /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
