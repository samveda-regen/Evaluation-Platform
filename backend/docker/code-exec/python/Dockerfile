FROM talentq/code-exec-base:dev

# python3 is already installed in the base image (supervisor.py needs it to
# run its own PID 1, regardless of language) - candidate Python execution
# rides on that same interpreter, so there is nothing further to install
# here. This image exists as its own tag anyway (rather than pointing
# pool.ts straight at the base image for python) so it can diverge later
# — e.g. adding pip packages — without touching every other language.
LABEL talentq.codeexec.lang=python
