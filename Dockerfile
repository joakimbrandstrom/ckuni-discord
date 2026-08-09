FROM registry.access.redhat.com/hi/nodejs:24-builder AS build

WORKDIR /app

COPY --chown=65532:65532 package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY --chown=65532:65532 tsconfig.json ./
COPY --chown=65532:65532 src ./src
COPY --chown=65532:65532 test ./test
COPY --chown=65532:65532 migrations ./migrations

RUN npm run build && npm prune --omit=dev


FROM registry.access.redhat.com/hi/nodejs:24 AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=65532:65532 /app/package.json ./package.json
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=build --chown=65532:65532 /app/migrations ./migrations

USER 65532

EXPOSE 3000

CMD ["node", "dist/src/index.js"]