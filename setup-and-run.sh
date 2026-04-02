#!/usr/bin/env bash
set -euo pipefail

# 1) Env file
[ -f backend/.env ] || cp backend/.env.example backend/.env

# 2) Install deps
npm --prefix backend install
npm --prefix frontend install

# 3) Database + Prisma
npm --prefix backend run db:generate
npm --prefix backend run db:push

# Optional seed: ./setup-and-run.sh --seed
if [[ "${1:-}" == "--seed" ]]; then
  npm --prefix backend run db:seed
fi

# 4) Start both servers
cleanup() {
  [[ -n "${BACK_PID:-}" ]] && kill "$BACK_PID" 2>/dev/null || true
  [[ -n "${FRONT_PID:-}" ]] && kill "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm --prefix backend run dev &
BACK_PID=$!

echo "Waiting for backend health check..."
BACKEND_READY=false
for _ in {1..30}; do
  if ! kill -0 "$BACK_PID" 2>/dev/null; then
    echo "Backend exited early. Check backend logs above."
    exit 1
  fi

  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    BACKEND_READY=true
    break
  fi

  sleep 1
done

if [[ "$BACKEND_READY" != "true" ]]; then
  echo "Backend did not become healthy at http://localhost:3000/api/health."
  echo "Verify PostgreSQL and backend/.env DATABASE_URL, then retry."
  exit 1
fi

npm --prefix frontend run dev &
FRONT_PID=$!

echo ""
echo "Admin:     http://localhost:5173/admin/login"
echo "Candidate: http://localhost:5173/test/login"
echo "Press Ctrl+C to stop both servers."
wait
