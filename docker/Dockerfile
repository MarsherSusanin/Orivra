FROM --platform=linux/amd64 node@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de AS dependency-cache
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/action/package.json packages/action/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/fdc-coston2/package.json packages/fdc-coston2/package.json
ARG NPM_CONFIG_OFFLINE=false
ENV NPM_CONFIG_OFFLINE=${NPM_CONFIG_OFFLINE}
RUN --mount=type=cache,id=proofline-027a-npm,target=/root/.npm,sharing=locked \
    npm ci

FROM --platform=linux/amd64 node@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de AS build
WORKDIR /workspace
COPY --from=dependency-cache /workspace/node_modules ./node_modules
COPY package.json package-lock.json index.html tsconfig.json vite.config.mjs ./
COPY src ./src
COPY apps ./apps
COPY packages ./packages
COPY contracts ./contracts
RUN npm exec vite -- build
RUN npm run --workspace @proofline/api build
RUN npm run --workspace @proofline/api build:import-canonical-url-attack
RUN npm run --workspace @proofline/worker build

FROM --platform=linux/amd64 node@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de AS web
WORKDIR /srv
ENV NODE_ENV=production PORT=8080 PROOFLINE_WEB_ROOT=/srv/web
COPY --from=build --chown=node:node /workspace/dist/client /srv/web
COPY --chown=node:node docker/web-server.mjs /srv/web-server.mjs
USER node
EXPOSE 8080
CMD ["node", "/srv/web-server.mjs"]

FROM --platform=linux/amd64 node@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependency-cache /workspace/node_modules /app/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist/server.js /app/apps/api/dist/server.js
COPY --from=build --chown=node:node /workspace/apps/api/dist/migrate.js /app/apps/api/dist/migrate.js
COPY --from=build --chown=node:node /workspace/apps/api/dist/db-role-bootstrap.js /app/apps/api/dist/db-role-bootstrap.js
COPY --from=build --chown=node:node /workspace/apps/api/dist/import-canonical-url-attack-recording.js /app/apps/api/dist/import-canonical-url-attack-recording.js
COPY --from=build --chown=node:node /workspace/apps/api/db/migrations /app/apps/api/db/migrations
RUN test -f /app/apps/api/db/migrations/manifest.v1.json
COPY --from=build --chown=node:node /workspace/contracts/CanonicalSafeWeb2JsonConsumer.sol /app/contracts/CanonicalSafeWeb2JsonConsumer.sol
COPY --from=build --chown=node:node /workspace/contracts/CanonicalVulnerableWeb2JsonConsumer.sol /app/contracts/CanonicalVulnerableWeb2JsonConsumer.sol
COPY --from=build --chown=node:node /workspace/contracts/ProoflineUrlInvariant.sol /app/contracts/ProoflineUrlInvariant.sol
USER node
EXPOSE 8080
CMD ["node", "/app/apps/api/dist/server.js"]

FROM --platform=linux/amd64 node@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependency-cache /workspace/node_modules /app/node_modules
# The bundle keeps the pg and solc runtime packages external.
COPY --from=build --chown=node:node /workspace/apps/worker/dist/worker.js /app/apps/worker/dist/worker.js
USER node
CMD ["node", "/app/apps/worker/dist/worker.js"]
