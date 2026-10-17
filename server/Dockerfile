# Container image for the AxiomFlo API on Google Cloud Run.
# Build from this folder:  gcloud run deploy axiomflo-api --source server ...
# Stage 1 compiles TypeScript; stage 2 runs only the compiled code and production packages.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Run as the unprivileged "node" user that the image provides.
USER node
# Cloud Run sets PORT (8080 by default); the server listens on 0.0.0.0:$PORT.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
