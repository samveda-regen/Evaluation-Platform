FROM talentq/code-exec-base:dev

# Same JDK the old single shared image installed.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

LABEL talentq.codeexec.lang=java
