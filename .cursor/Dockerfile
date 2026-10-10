FROM ubuntu:24.04

ARG NODE_VERSION=22.14.0

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git xz-utils python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --no-same-owner \
  && corepack enable \
  && python3 -m pip install --break-system-packages 'pyyaml>=6.0' 'ruamel.yaml>=0.18'

USER ubuntu
