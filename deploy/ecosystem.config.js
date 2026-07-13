// PM2 process manager config. Run from the repo root on the droplet:
//   pm2 start deploy/ecosystem.config.js
//   pm2 save && pm2 startup     (so it survives a reboot)
//
// Both apps read backend/.env via the app's own loadEnvFile() logic — no env
// needs to be duplicated here.
module.exports = {
  apps: [
    {
      name: 'talentq-api',
      cwd: './backend',
      script: 'dist/index.js',
      instances: 1, // single instance only — in-process workers + socket.io
                    // have no cross-instance coordination (see README notes);
                    // scale this app vertically, not horizontally, for now
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'talentq-code-worker',
      cwd: './backend',
      script: 'dist/workers/codeExecutionWorker.js',
      instances: 1, // raise this (or run on a second droplet) to add code-
                    // execution capacity; each instance also respects
                    // CODE_EXEC_WORKER_CONCURRENCY from backend/.env
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
