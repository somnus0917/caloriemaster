#!/usr/bin/env bash
# Production deploy helper for the single-server Docker Compose setup.
#
# Expected server setup:
#   - DNS A/AAAA points to this server.
#   - Ports 80 and 443 are open.
#   - .env exists and contains production secrets.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill production values first." >&2
  exit 1
fi

echo "Building CalorieMaster image..."
docker compose build app

echo "Starting PostgreSQL..."
docker compose up -d postgres

echo "Running database migrations..."
docker compose run --rm app npm run db:migrate

echo "Starting application and Caddy..."
docker compose up -d app caddy

echo "Deployment complete."
docker compose ps
