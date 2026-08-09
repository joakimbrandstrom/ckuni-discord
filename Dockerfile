FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g npm@latest
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY migrations ./migrations
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g npm@latest
RUN useradd --uid 10001 --create-home appuser
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
USER appuser
EXPOSE 3000
CMD ["sh", "-c", "node dist/src/db/migrate.js && node dist/src/index.js"]
