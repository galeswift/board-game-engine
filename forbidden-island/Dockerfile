# Build context is the REPO ROOT, not forbidden-island/ - required so
# COPY can reach packages/rules-engine-core, which lives outside this
# folder (same pattern as patchwork/Dockerfile). Verified locally as:
#   docker build -f forbidden-island/Dockerfile -t forbidden-island-test .
#
# Railway needs Root Directory "forbidden-island" -> "." (repo root) for
# the build context, plus Settings -> Build -> Dockerfile Path set to
# "forbidden-island/Dockerfile" (a dedicated Settings UI field, not an
# environment variable) telling it which Dockerfile inside that context
# to use.
FROM node:20-slim
WORKDIR /app

COPY forbidden-island/package.json forbidden-island/package-lock.json* ./
RUN npm install --omit=dev

COPY forbidden-island/server.js forbidden-island/gameDefinition.js ./
COPY forbidden-island/public ./public
COPY packages/rules-engine-core ../packages/rules-engine-core

EXPOSE 3000
CMD ["node", "server.js"]
