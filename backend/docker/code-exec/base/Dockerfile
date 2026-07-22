FROM debian:bookworm-slim

# Common foundation shared by every language-specific code-exec image
# (docker/code-exec/<lang>/Dockerfile, each `FROM talentq/code-exec-base:dev`).
# Holds everything that doesn't depend on which language a candidate is
# writing in: the supervisor process itself, sandbox users, and the
# firewall-helper tooling. Language images layer only their own
# runtime/compiler on top - see each <lang>/Dockerfile's own comment.
#
# python3 is installed here (not in a "python" layer) because supervisor.py
# itself is a Python process - every language image needs python3 present
# just to run its own PID 1, regardless of what language candidates submit
# in. This means the python-specific image ends up not needing to add
# anything at all on top of base for its own runtime.
#
# Isolation between concurrent executions inside one container comes from
# per-job Linux users + rlimits (see supervisor.py), not from separating
# toolchains into separate images - the per-language split here is purely
# about image size/build time (a java submission no longer pulls g++/gcc
# layers it'll never use, and vice versa), not a security boundary.
#
# iptables is not used by the sandboxed pool containers themselves - it's
# here so this base image can also run as a short-lived, --network host,
# --cap-add NET_ADMIN *helper* container (see pool.ts's applyEgressFirewall,
# which now points at this base image specifically via CODE_EXEC_BASE_IMAGE)
# that installs the DOCKER-USER firewall rule blocking candidate code's
# internet egress. Reusing this image avoids pulling a second one just for
# that one-shot setup step.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3 \
        coreutils \
        iptables \
    && rm -rf /var/lib/apt/lists/*

# One throwaway, no-login, home-less Linux user per concurrent execution
# slot, each with its OWN matching-numeric-ID group (not `--no-user-group`,
# which silently falls back to the shared system "users" group for every
# sandbox user — supervisor.py's os.setgid(uid) assumes a group with that
# exact gid exists). supervisor.py hands each incoming job one of these
# UIDs and drops to it (setgid+setuid, one-way, irreversible) before ever
# running candidate code — this is what makes two candidates' code running
# at the same instant in the same container unable to see or signal each
# other's processes, despite sharing one PID namespace. Count must match
# SANDBOX_UID_COUNT below and pool.ts's per-container slot count. Baked into
# base so every language image inherits the identical set of UIDs without
# repeating this step.
ARG SANDBOX_UID_BASE=2000
ARG SANDBOX_UID_COUNT=8
RUN for i in $(seq 1 ${SANDBOX_UID_COUNT}); do \
        uid=$((${SANDBOX_UID_BASE}+i)); \
        groupadd --gid ${uid} sandbox${i} && \
        useradd --no-create-home --uid ${uid} --gid ${uid} \
            --shell /usr/sbin/nologin sandbox${i}; \
    done

COPY supervisor.py /usr/local/bin/supervisor.py
RUN chmod +x /usr/local/bin/supervisor.py

WORKDIR /workspace
ENV SANDBOX_UID_COUNT=${SANDBOX_UID_COUNT}
ENV SUPERVISOR_PORT=8000
EXPOSE 8000

# No USER directive (stays root) — deliberate, not an oversight. The
# supervisor process needs CAP_SETUID/CAP_SETGID to drop each job to its
# own sandbox UID, CAP_CHOWN to hand job files over to that UID, and
# CAP_KILL to signal a different UID's process on timeout (see pool.ts's
# CapAdd, which grants only those four on top of CapDrop: ALL). Root here
# is *this* trusted, reviewed process; every actual candidate execution runs
# as a capability-less sandbox UID, dropped to before candidate code ever
# executes — see supervisor.py's make_preexec(). Every language image
# inherits this same CMD unchanged.
CMD ["python3", "/usr/local/bin/supervisor.py"]
