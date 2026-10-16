# Container image for hosting the AxiomFlo pilot UI (e.g. on Google Cloud Run).
# Stage 1 builds the static site; stage 2 serves it with nginx.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Cloud Run tells the container which port to listen on via $PORT (8080 by default).
ENV PORT=8080
# The nginx image fills in ${PORT} in templates at startup.
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
