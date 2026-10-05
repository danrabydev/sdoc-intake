# Local test harness for Monotoba/specforge (not maintained upstream).
# Pinned to release v0.21.1 (commit 0bb8610d93b0bc06eff3ced6a2f612e2e24bd02e).

ARG SPECFORGE_REF=v0.21.1
ARG SPECFORGE_REPO=https://github.com/Monotoba/specforge.git

FROM python:3.12-slim AS build

ARG SPECFORGE_REF
ARG SPECFORGE_REPO

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch "${SPECFORGE_REF}" "${SPECFORGE_REPO}" specforge \
    && pip install --no-cache-dir --prefix=/install /src/specforge

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 specforge \
    && useradd --uid 1000 --gid specforge --create-home --shell /usr/sbin/nologin specforge \
    && mkdir -p /projects \
    && chown specforge:specforge /projects

COPY --from=build /install /usr/local

# Match compose volume ./projects:/projects so init/open paths persist on the host.
WORKDIR /projects
USER specforge

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8765/ || exit 1

# Upstream specforge-daemon binds 127.0.0.1; publish 0.0.0.0 for Docker port mapping.
CMD ["uvicorn", "specforge_daemon.api:app", "--host", "0.0.0.0", "--port", "8765"]
