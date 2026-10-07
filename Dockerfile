# ReqAML — one Dockerfile, multiple targets (ARCH-DEPLOY-MINIMAL / ARCH-DEPLOY-PERIPHERALS).
# syntax=docker/dockerfile:1

ARG OPENBAO_VERSION=2.1.0

FROM node:22-bookworm-slim AS node-base
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /repo

FROM node-base AS app-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/reqaml/package.json apps/reqaml/package.json
COPY packages/intake/package.json packages/intake/package.json
RUN pnpm install --filter @reqaml/app --frozen-lockfile

FROM app-deps AS app-build
COPY apps/reqaml apps/reqaml
COPY docs/design/seed docs/design/seed
RUN pnpm --filter @reqaml/app build

FROM node-base AS app
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo/apps/reqaml
COPY --from=app-deps /repo/node_modules /repo/node_modules
COPY --from=app-deps /repo/apps/reqaml/node_modules ./node_modules
COPY --from=app-build /repo/apps/reqaml/dist ./dist
COPY --from=app-build /repo/apps/reqaml/openapi ./openapi
COPY --from=app-build /repo/apps/reqaml/package.json ./package.json
COPY --from=app-build /repo/docs/design/seed /repo/docs/design/seed
COPY docker/app-entrypoint.sh /usr/local/bin/reqaml-entrypoint.sh
RUN chmod +x /usr/local/bin/reqaml-entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=30s \
  CMD curl -sf "http://127.0.0.1:${REQAML_PORT:-3000}/ready" || exit 1
ENTRYPOINT ["/usr/local/bin/reqaml-entrypoint.sh"]
CMD ["node", "dist/main.js"]

FROM postgres:16-bookworm AS peripherals
ARG OPENBAO_VERSION
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates jq unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /tmp/openbao.zip \
    "https://github.com/openbao/openbao/releases/download/v${OPENBAO_VERSION}/openbao_${OPENBAO_VERSION}_linux_amd64.zip" \
  && unzip /tmp/openbao.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/bao \
  && rm /tmp/openbao.zip

COPY docker/peripherals/openbao.hcl /etc/openbao/openbao.hcl
COPY docker/peripherals/openbao-init.sh /docker/openbao-init.sh
COPY docker/peripherals/wait-and-init-openbao.sh /wait-and-init-openbao.sh
COPY docker/peripherals/entrypoint.sh /entrypoint.sh
COPY docker/peripherals/healthcheck.sh /healthcheck.sh
RUN chmod +x /docker/openbao-init.sh /wait-and-init-openbao.sh /entrypoint.sh /healthcheck.sh

ENV POSTGRES_USER=reqaml
ENV POSTGRES_PASSWORD=reqaml
ENV POSTGRES_DB=reqaml

VOLUME ["/var/lib/postgresql/data", "/var/lib/reqaml/openbao", "/var/lib/reqaml/secrets"]

EXPOSE 5432 8200
HEALTHCHECK --interval=10s --timeout=5s --retries=18 --start-period=40s \
  CMD /healthcheck.sh
ENTRYPOINT ["/entrypoint.sh"]

# Optional SoftHSM2 build target (profile hsm-test; not in default stack).
FROM app AS app-hsm-test
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends softhsm2 \
  && rm -rf /var/lib/apt/lists/*
USER node
ENV REQAML_PKCS11_ENABLED=1
