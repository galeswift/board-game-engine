# Build context is now the REPO ROOT, not patchwork/ - required so
# COPY can reach packages/rules-engine-core, which lives outside this
# folder (see docs/patchwork-next-steps.md's "retrofit onto the generic
# phases/transitions design" entry). Verified locally as:
#   docker build -f patchwork/Dockerfile -t patchwork-test .
#
# Railway needs TWO settings changed to match (Root Directory alone is
# not enough - Railway's default Dockerfile discovery only looks at the
# top of Root Directory, not subfolders; see README.md's Railway setup
# section):
#   1. Root Directory: "patchwork" -> "." (repo root) - this is what
#      becomes the build context.
#   2. Settings -> Build -> Dockerfile Path: "patchwork/Dockerfile" -
#      tells Railway which file, inside that context, is the Dockerfile.
#      (Not an environment variable - it's a dedicated field in the
#      Settings UI.)
# Both are one-time manual dashboard changes, not a new shared build
# step (still a single `docker build` invocation).
FROM node:20-slim AS web-build
WORKDIR /app/web
COPY patchwork/web/package.json patchwork/web/package-lock.json* ./
RUN npm install
COPY patchwork/web/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app

COPY patchwork/package.json patchwork/package-lock.json* ./
RUN npm install --omit=dev

COPY patchwork/server.js patchwork/gameDefinition.js patchwork/db.js patchwork/patches.js patchwork/timeTrack.js patchwork/patchCircle.js ./
COPY packages/rules-engine-core ../packages/rules-engine-core
COPY --from=web-build /app/web/dist ./web/dist

EXPOSE 3000
CMD ["node", "server.js"]
