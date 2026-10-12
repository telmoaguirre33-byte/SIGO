FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY src/modules/mayorista ./src/modules/mayorista
COPY docs/mayorista/sql ./docs/mayorista/sql
RUN npm ci --prefix src/modules/mayorista/backend --ignore-scripts --no-audit --no-fund
RUN npm ci --prefix src/modules/mayorista/demo --ignore-scripts --no-audit --no-fund
RUN cd src/modules/mayorista/demo && npm run typecheck && npm run build
RUN rm -rf src/modules/mayorista/demo/node_modules src/modules/mayorista/tests
FROM node:24.19.0-bookworm-slim
WORKDIR /app/src/modules/mayorista/backend
COPY --from=build --chown=node:node /app /app
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","server.mjs"]
