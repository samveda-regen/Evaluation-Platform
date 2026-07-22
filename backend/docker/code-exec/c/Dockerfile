FROM talentq/code-exec-base:dev

# Same gcc the old single shared image installed. libc6-dev (stdio.h and
# the rest of the C standard headers) has to be listed explicitly - it's
# only a Recommends of gcc on Debian, not a hard Depends, and
# --no-install-recommends skips those. The old single image never hit this
# because installing g++/python3/etc alongside gcc happened to pull it in
# as a transitive hard dependency of one of them; gcc alone here does not.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*

LABEL talentq.codeexec.lang=c
