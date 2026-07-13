FROM node:22-bookworm-slim

# All five candidate-facing toolchains live in one image. Isolation between
# executions comes from the container boundary (fresh container per run),
# not from separating toolchains into separate images.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3 \
        default-jdk-headless \
        g++ \
        gcc \
        coreutils \
    && rm -rf /var/lib/apt/lists/*

# Non-root user the container always runs as. The base node image already
# ships a uid/gid 1000 "node" user, so it's reused here rather than creating
# a second one. Combined with --read-only rootfs and a single writable
# /workspace bind mount, candidate code cannot write anywhere outside its own
# scratch directory.
WORKDIR /workspace
USER node

# No ENTRYPOINT/CMD: dockerode supplies the actual compile+run command per
# execution (see backend/src/utils/dockerSandbox.ts). The container is created,
# runs that one command, and is torn down (--rm) immediately after.
