module.exports = {
  apps: [
    {
      name: 'backend',
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
      name: 'frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'python-cv-service',
      cwd: './python_cv_service',
      script: 'venv/bin/uvicorn',
      args: 'app:app --host 0.0.0.0 --port 9010 --workers 4',
      interpreter: 'none',
      env: {
        PORT: 9010,
        WORKERS: 4
      }
    }
  ]
};
