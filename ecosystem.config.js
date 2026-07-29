module.exports = {
  apps: [
    {
      name: 'backend',
      cwd: './backend',
      script: 'dist/index.js',
      // backend/src/index.ts loads backend/.env itself at startup -- no env block needed here.
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'frontend',
      cwd: './frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --host 0.0.0.0 --port 5173',
    },
    {
      name: 'superadmin-frontend',
      cwd: './superadmin-frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --host 0.0.0.0 --port 2002',
    },
    {
      name: 'python-cv-service',
      cwd: './python_cv_service',
      script: 'start.sh',
      interpreter: 'bash',
      // start.sh reads WORKERS/PORT/CV_INFERENCE_THREADS from env, defaulting
      // WORKERS=4, PORT=8010. python_cv_service/.env is loaded by app.py itself.
    },
  ],
};
