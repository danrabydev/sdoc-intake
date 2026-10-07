# syntax=docker/dockerfile:1
# ReqAML — one Dockerfile, multiple targets (ARCH-DEPLOY-MINIMAL / ARCH-DEPLOY-PERIPHERALS).

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
# Set by BuildKit (amd64 / arm64). OpenBao release assets are named bao_<ver>_Linux_<x86_64|arm64>.tar.gz.
ARG TARGETARCH
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates jq \
  && rm -rf /var/lib/apt/lists/* \
  && case "${TARGETARCH:-amd64}" in \
       amd64) bao_arch=x86_64 ;; \
       arm64) bao_arch=arm64 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && bao_tgz="bao_${OPENBAO_VERSION}_Linux_${bao_arch}.tar.gz" \
  && base="https://github.com/openbao/openbao/releases/download/v${OPENBAO_VERSION}" \
  && curl -fsSL -o "/tmp/${bao_tgz}" "${base}/${bao_tgz}" \
  && curl -fsSL -o /tmp/checksums-linux.txt "${base}/checksums-linux.txt" \
  && (cd /tmp && grep " ${bao_tgz}\$" checksums-linux.txt | sha256sum -c -) \
  && tar -xzf "/tmp/${bao_tgz}" -C /usr/local/bin bao \
  && chmod +x /usr/local/bin/bao \
  && rm -f "/tmp/${bao_tgz}" /tmp/checksums-linux.txt \
  && bao version

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
