FROM node:22.23.5-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=peer

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src

# Small VPS builds can use swap instead of the automatic 512 MiB V8 heap.
ARG NODE_BUILD_HEAP_MB=1536
RUN NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" npm run build

FROM node:22.23.5-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=peer --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts/x402-interrupted-canary.mjs ./operator/x402-interrupted-canary.mjs

EXPOSE 3001

CMD ["npm", "run", "start"]
