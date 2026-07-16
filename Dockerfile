# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
# Build-stage-only placeholder so prisma.config.ts's env('DATABASE_URL') resolves
# during config loading. `prisma generate` does not connect to a DB; the real
# DATABASE_URL is supplied at container runtime (see docker-compose.yml) for
# `prisma migrate deploy` in the entrypoint. Not carried into the runtime stage.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json prisma.config.ts turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate
RUN pnpm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
