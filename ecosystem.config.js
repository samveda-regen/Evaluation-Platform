module.exports = {
  apps: [
    {
      name: 'mg-backend',
      cwd: './backend',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      }
    },
    {
      name: 'mg-frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'mg-python-cv-service',
      cwd: './python_cv_service',
      script: 'venv/bin/uvicorn',
      args: 'app:app --host 0.0.0.0 --port 9010 --workers 1',
      interpreter: 'none',
      env: {
        PORT: 9010,
        WORKERS: 1
      }
    },
    {
      name: 'mg-python-speech',
      cwd: './python_speech_service',
      script: '.venv/bin/uvicorn',
      args: 'app:app --host 0.0.0.0 --port 9020 --workers 1',
      interpreter: 'none',
      env: {
        PORT: 9020,
        WORKERS: 1,
        // Set on the droplet's shell (export HF_TOKEN=...) before starting/reloading pm2 —
        // deliberately not hardcoded here so the token never ends up committed to git.
        HF_TOKEN: process.env.HF_TOKEN || ''
      }
    }
  ]
};
