# mirror.gcr.io is Google's pull-through cache of Docker Hub. Pulls from it
# inside Cloud Build are not rate-limited, which neither docker.io nor
# public.ecr.aws can promise: both are throttled by source IP, and Cloud Build
# shares egress addresses across everyone in the region.
#
# This is not theoretical. The ECR mirror was chosen first, for exactly this
# reason, and still failed on the second build of the day with
# "toomanyrequests: Rate exceeded".
FROM mirror.gcr.io/library/node:26-slim AS build

WORKDIR /repo

# Manifests first so the dependency layer survives source-only changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/

RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm run typecheck

# Drop dev dependencies from the tree we are about to copy forward.
RUN npm prune --omit=dev


FROM mirror.gcr.io/library/node:26-slim AS runtime

ENV NODE_ENV=production
WORKDIR /repo

# node:*-slim ships a `node` user. Running as root inside a container buys
# nothing here and costs the usual.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/packages ./packages
COPY --from=build --chown=node:node /repo/apps ./apps

USER node

# Cloud Run overrides this with its own PORT; the default keeps `docker run`
# working locally without arguments.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/api/dist/server.js"]
