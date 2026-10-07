FROM node:24.15.0-bookworm-slim

ARG CLAUDE_CODE_VERSION
ARG CLAUDE_CODE_LINUX_X64_SHA256

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    test -n "${CLAUDE_CODE_VERSION}"; \
    test -n "${CLAUDE_CODE_LINUX_X64_SHA256}"; \
    url="https://downloads.claude.ai/claude-code-releases/${CLAUDE_CODE_VERSION}/linux-x64/claude"; \
    curl --fail --location --silent --show-error "${url}" --output /tmp/claude; \
    echo "${CLAUDE_CODE_LINUX_X64_SHA256}  /tmp/claude" | sha256sum --check --status; \
    install --mode=0755 /tmp/claude /usr/local/bin/claude; \
    rm /tmp/claude; \
    claude --version | grep --fixed-strings "${CLAUDE_CODE_VERSION}"
