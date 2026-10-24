# syntax=docker/dockerfile:1

FROM debian:12-slim AS devbox-artifacts
ARG TARGETARCH
ARG HAPPIER_RELEASE_BASE_URL=""
ARG HAPPIER_RELEASE_PUBLIC_KEY_BASE64=""
ARG HAPPIER_DEVBOX_CLI_RELEASE_TAG=""
ARG HAPPIER_DEVBOX_CLI_VERSION=""

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar minisign \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/pipeline/docker/fetch-verified-release-artifact.sh /usr/local/bin/fetch-verified-release-artifact
RUN chmod +x /usr/local/bin/fetch-verified-release-artifact

RUN set -eux; \
  test -n "$HAPPIER_RELEASE_PUBLIC_KEY_BASE64"; \
  printf '%s' "$HAPPIER_RELEASE_PUBLIC_KEY_BASE64" | base64 -d > /tmp/happier-release.pub; \
  case "$TARGETARCH" in \
    amd64) artifact_arch="x64" ;; \
    arm64) artifact_arch="arm64" ;; \
    *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  fetch-verified-release-artifact \
    --base-url "$HAPPIER_RELEASE_BASE_URL" \
    --release-tag "$HAPPIER_DEVBOX_CLI_RELEASE_TAG" \
    --product happier \
    --version "$HAPPIER_DEVBOX_CLI_VERSION" \
    --os linux \
    --arch "$artifact_arch" \
    --dest /opt/happier/cli \
    --pubkey /tmp/happier-release.pub

FROM debian:12-slim AS devbox

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    ffmpeg \
    git \
    openssh-client \
    python3 \
    tar \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash happier \
  && mkdir -p /opt/happier/cli /home/happier/.local/bin /home/happier/.npm-global /workspace \
  && chown -R happier:happier /home/happier /opt/happier /workspace

ENV NPM_CONFIG_PREFIX=/home/happier/.npm-global
ENV PATH=/opt/happier/cli:/home/happier/.local/bin:/home/happier/.npm-global/bin:$PATH

COPY --from=devbox-artifacts --chown=happier:happier /opt/happier/cli /opt/happier/cli
RUN chmod +x /opt/happier/cli/happier \
  && ln -sf /opt/happier/cli/happier /usr/local/bin/happier

COPY docker/dev-box/entrypoint.sh /usr/local/bin/happier-dev-box-entrypoint
RUN chmod +x /usr/local/bin/happier-dev-box-entrypoint

USER happier
WORKDIR /workspace

ENTRYPOINT ["happier-dev-box-entrypoint"]
CMD ["bash"]
