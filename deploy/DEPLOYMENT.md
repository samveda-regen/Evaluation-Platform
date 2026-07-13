# Deployment runbook — DigitalOcean droplet (4 vCPU / 8GB)

Run these on the droplet itself (SSH in, or run a Claude Code session there if you want AI help executing them). Assumes Ubuntu, and that Docker is already installed per your plan.

## 1. One-time OS setup

```bash
# Node.js 22 (matches dev)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (process manager)
sudo npm install -g pm2

# nginx + certbot
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Docker Compose plugin (if not already part of your Docker install)
sudo apt-get install -y docker-compose-plugin
```

## 2. Get the code onto the droplet

```bash
sudo mkdir -p /var/www/talentq
sudo chown $USER:$USER /var/www/talentq
git clone <your-repo-url> /var/www/talentq
cd /var/www/talentq
```

## 3. Configure environment files

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env                      # set POSTGRES_PASSWORD, REDIS_PASSWORD

cp .env.production.example backend/.env
nano backend/.env                     # fill in every REPLACE_ME (see the file's comments)
```

Generate secrets as needed: `openssl rand -hex 64`

## 4. Start Postgres + Redis

```bash
cd deploy
docker compose --env-file .env -f docker-compose.prod.yml up -d
docker compose --env-file .env -f docker-compose.prod.yml ps   # confirm both are healthy
cd ..
```

## 5. Build the code-execution sandbox image

```bash
cd backend
npm run docker:build:code-exec
# tag it to match CODE_EXEC_DOCKER_IMAGE in backend/.env (talentq/code-exec:prod)
docker tag talentq/code-exec:dev talentq/code-exec:prod
cd ..
```

## 6. Install dependencies, generate Prisma client, sync schema

```bash
cd backend
npm install
npx prisma generate
npx prisma db push        # first deploy only; use `prisma migrate deploy` if you adopt real migrations later
npm run build              # produces backend/dist
cd ..
```

## 7. Build the frontend

```bash
cd frontend
npm install
npm run build               # produces frontend/dist, served by nginx
cd ..
```

## 8. Start the app with PM2

```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup                 # follow the printed instructions to survive reboots
pm2 status                  # confirm talentq-api and talentq-code-worker are online
```

## 9. Python CV service (proctoring)

```bash
cd python_cv_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
cd ..
```
Add a third PM2 entry (or a systemd unit) to keep it running, e.g.:
```bash
pm2 start "python_cv_service/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8010 --workers 4" \
  --name talentq-cv --cwd python_cv_service
pm2 save
```

## 10. nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/talentq
sudo nano /etc/nginx/sites-available/talentq   # replace yourdomain.com
sudo ln -s /etc/nginx/sites-available/talentq /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com          # sets up HTTPS + auto-renewal
```

Point your domain's DNS A record at the droplet's IP before running certbot.

## 11. Verify

```bash
curl https://yourdomain.com/api/health
curl https://yourdomain.com/api/health/queues
curl https://yourdomain.com/api/health/proctoring
```
Then open the site in a browser and run through a candidate test end to end (Run + Submit a coding question).

## Deploying updates later

```bash
cd /var/www/talentq
git pull
cd backend && npm install && npx prisma generate && npm run build && cd ..
cd frontend && npm install && npm run build && cd ..
pm2 reload deploy/ecosystem.config.js   # zero-downtime reload of API + worker
```

If `docker/code-exec/Dockerfile` changed, rebuild and re-tag the image (step 5) before reloading.

## Notes / limits carried over from dev

- Single API instance only — no `@socket.io/redis-adapter` yet, so don't run more than one `talentq-api` PM2 instance without adding that first.
- `CODE_EXEC_WORKER_CONCURRENCY=3` and `CODE_EXEC_CONTAINER_CPUS=1` are a conservative starting point for 4 vCPU — watch `/api/health/queues` under real load before raising them.
- Back up Postgres yourself (self-hosted, no managed backups) — e.g. a nightly cron running `docker exec` + `pg_dump` to off-droplet storage.
