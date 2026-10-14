FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY src/modules/mayorista ./src/modules/mayorista
COPY docs/mayorista/sql ./docs/mayorista/sql
COPY supabase/migrations ./supabase/migrations
COPY api/arca ./api/arca
COPY api/mayorista ./api/mayorista
RUN npm ci --prefix src/modules/mayorista/backend --ignore-scripts --no-audit --no-fund
RUN ln -s /app/src/modules/mayorista/backend/node_modules /app/node_modules
RUN npm ci --prefix src/modules/mayorista/demo --ignore-scripts --no-audit --no-fund
RUN cd src/modules/mayorista/demo && npm run typecheck && npm run build
RUN rm -rf src/modules/mayorista/demo/node_modules && find src/modules/mayorista/tests -type f ! -name 'business-type-sql.mjs' ! -name 'shared-commerce-sql.mjs' ! -name 'shared-fixture-policy.mjs' ! -name 'shared-backend.mjs' ! -name 'shared-fiscal.mjs' ! -name 'shared-credit-notes.mjs' -delete
FROM node:24.19.0-bookworm-slim
WORKDIR /app/src/modules/mayorista/backend
COPY --from=build --chown=node:node /app /app
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","/app/src/modules/mayorista/backend/server.mjs"]
