FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/docs /app/evaluations /app/public /app/research /data /public-data /public-state \
  && chown -R node:node /app /data /public-data /public-state

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node docs/prompt.md ./docs/prompt.md
COPY --chown=node:node evaluations/conversational-quality-v1.json ./evaluations/conversational-quality-v1.json
COPY --chown=node:node public ./public
COPY --chown=node:node research ./research

USER node

EXPOSE 8421 8431

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node --input-type=module -e "const port=process.env.JOLENE_PORT||'8421';const response=await fetch('http://127.0.0.1:'+port+'/health');if(!response.ok)process.exit(1)"

CMD ["node", "dist/server.js"]
