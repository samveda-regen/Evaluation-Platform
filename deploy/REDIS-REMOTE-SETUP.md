# Running Redis on the droplet while the app runs locally

This is for testing now, before the full production deployment (see `DEPLOYMENT.md` for that later). Everything except Redis — Postgres, the backend, the frontend, the Python CV service — stays on your local machine. Only Redis moves to the droplet.

## On the droplet

```bash
# 1. Docker (you're installing this yourself)

# 2. Get this one file onto the droplet (scp it, or clone the repo there too)
mkdir -p ~/redis-only && cd ~/redis-only
# copy deploy/docker-compose.redis-only.yml into this directory

# 3. Set a strong password
cat > .env << 'EOF'
REDIS_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD
EOF

# 4. Start it
docker compose --env-file .env -f docker-compose.redis-only.yml up -d
docker compose --env-file .env -f docker-compose.redis-only.yml ps   # confirm healthy
```

Note it's bound to `127.0.0.1:6379` on the droplet — deliberately not reachable from outside the droplet at all. That's what the SSH tunnel below is for.

## On your local machine

**Open a tunnel** (keep this running in its own terminal while you work):
```bash
ssh -N -L 6379:localhost:6379 your-droplet-user@your-droplet-ip
```
This makes `localhost:6379` on your machine transparently forward to `127.0.0.1:6379` on the droplet, over SSH's existing encrypted connection. Nothing else changes.

**Point the app at it** — in `backend/.env`:
```
REDIS_URL=redis://:REPLACE_WITH_THE_SAME_PASSWORD@localhost:6379
```
(same value as the droplet's `.env` `REDIS_PASSWORD`)

Restart the backend API and `codeExecutionWorker` after changing this so they pick up the new `REDIS_URL`.

## Verify

With the tunnel open:
```bash
curl http://localhost:3000/api/health/queues
```
Should return `{"status":"ok", ...}` instead of a connection error — confirms the API can reach Redis through the tunnel.

## If the tunnel drops

BullMQ will just queue up retries and your app will briefly show "Server is busy" for code runs/submits until you reopen the tunnel — nothing gets corrupted, it just pauses. Reopen with the same `ssh -N -L ...` command.

## Later, when you deploy the whole app to the droplet

Drop this setup — switch to `docker-compose.prod.yml` (which also runs Postgres) and set `REDIS_URL=redis://:PASSWORD@127.0.0.1:6379` in `backend/.env` on the droplet itself, since at that point the app and Redis are on the same machine again and the tunnel is no longer needed. See `DEPLOYMENT.md`.
