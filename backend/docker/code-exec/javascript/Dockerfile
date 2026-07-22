FROM talentq/code-exec-base:dev

# Node 22, matching what the old single shared image got for free from its
# `FROM node:22-bookworm-slim` base. Debian bookworm's own apt `nodejs`
# package lags well behind current releases, so NodeSource's setup script is
# used to pull actual v22.x from their official apt repo instead. curl/gnupg
# are only needed to add that repo and are removed again afterward so they
# don't linger in the final image.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

LABEL talentq.codeexec.lang=javascript
