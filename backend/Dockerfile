FROM node:22-alpine AS dependencies
WORKDIR /app

RUN apk add --no-cache openssl
RUN chown node:node /app

COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci

FROM dependencies AS build
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts tsconfig.json ./
COPY --chown=node:node src ./src

RUN npm run prisma:generate
RUN npm run build

FROM build AS tools
CMD ["npm", "run", "prisma:migrate"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=production-dependencies /app/package.json ./package.json
COPY --chown=node:node --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
