# Production Deployment Guide

This guide targets a personal, password-protected deployment on a mainland China Linux server. The application reads cached translations from PostgreSQL during page visits; AI model calls happen only inside the background translation worker.

## Server Baseline

- 2 vCPU and 4 GB memory is the recommended starting point.
- 40 GB system disk is acceptable for a small private corpus; choose a larger data disk if you want long backup history.
- Ubuntu 22.04 LTS or 24.04 LTS is the preferred host OS.
- Open inbound ports 80 and 443 only. SSH should be restricted by key, IP allowlist, or cloud firewall rules.
- Install Docker Engine, Docker Compose plugin, Git, and basic monitoring from the cloud vendor console.

## Domain And Filing Checklist

- Point an A record for the selected domain to the server public IP before starting Caddy.
- Complete Hubei ICP filing for the domain if the server is in mainland China and the site is publicly reachable.
- After ICP approval, complete the public-security filing when required by the local public-security portal.
- Keep the filing owner, domain owner, and server account identity consistent where the provider requires it.
- Do not publish the site without the single-user password gate. Public domain plus password is the intended access model.

## Secret Bootstrap

1. Copy the template:

   ```bash
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```

2. Edit `.env.production`:

   ```bash
   nano .env.production
   ```

3. Set `SITE_DOMAIN` to the hostname only, for example `docs.example.com`.
4. Set `APP_ORIGIN` to the HTTPS origin, for example `https://docs.example.com`.
5. Generate a PostgreSQL password and use the same value in `POSTGRES_PASSWORD` and `DATABASE_URL`.
6. Generate `MODEL_KEY_ENCRYPTION_KEY` with a high-entropy value:

   ```bash
   openssl rand -base64 32
   ```

7. Keep model provider API keys out of `.env.production`. Add or replace them from the protected `/admin` screen after login.

## First Deployment

Build and start the stack:

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --build
```

Run migrations:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec web corepack pnpm db:migrate
```

Set the single-user login password. The password is entered interactively and stored as an Argon2id hash in PostgreSQL:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec web corepack pnpm admin set-password
```

Optional demo data for a private smoke test:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec web corepack pnpm preview:seed
```

## Smoke Checks

Check container health:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
```

Check the live endpoint:

```bash
curl -fsS https://docs.example.com/api/health/live
```

Check readiness from inside the stack:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec web wget -qO- http://127.0.0.1:3000/api/health/ready
```

Then visit:

- `https://docs.example.com/login`
- `https://docs.example.com/docs/apps/build` after preview seed or after real ingestion has cached a page
- `https://docs.example.com/search?q=Shopify%20CLI`
- `https://docs.example.com/admin`

## Daily Backup

The `backup` service runs `corepack pnpm backup` once per `BACKUP_INTERVAL_SECONDS`. The default interval is 86400 seconds, and `BACKUP_RETENTION_DAYS=14`.

Backups are written to the Docker volume mounted at `/backups`. Each dump has a matching `.sha256` checksum file. The service deletes only matching expired backup artifacts.

Verify a selected backup by restoring it into a temporary database and dropping that database afterwards:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec backup sh -c 'BACKUP_DUMP_PATH=/backups/shopify-docs-20260618-072000.dump corepack pnpm backup:verify'
```

`BACKUP_CHECKSUM_PATH` is optional; by default the command reads `${BACKUP_DUMP_PATH}.sha256`. The verification command creates a temporary `shopify_docs_restore_verify_*` database, runs `pg_restore`, probes the restored database, and drops the temporary database. It does not overwrite the production database.

Recommended off-server copy:

```bash
docker run --rm -v shopify-dev-chinese-proxy_shopify_backups:/backups -v "$PWD":/export alpine sh -c 'tar -czf /export/shopify-backups.tgz -C /backups .'
```

Upload the archive to OSS, COS, OBS, or another private storage location. Keep at least one copy outside the server.

## Upgrade

Fetch the new code, rebuild, run migrations, and restart:

```bash
git pull
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml exec web corepack pnpm db:migrate
docker compose --env-file .env.production -f compose.production.yaml ps
```

If a migration is included, create a manual backup before the upgrade:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec backup corepack pnpm backup
```

## Rollback

Use rollback when the new image starts but behavior is wrong:

```bash
git log --oneline -5
git checkout <previous-good-commit>
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

If the failed release included a database migration, restore a backup made before the migration instead of only changing the image.

## Restore

1. Stop application services while keeping the database container available:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml stop web worker translation-worker backup
   ```

2. Copy the selected dump into the database container:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml cp ./shopify-docs.dump db:/tmp/shopify-docs.dump
   ```

3. Verify that the backup can be restored into a temporary database:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml exec backup sh -c 'BACKUP_DUMP_PATH=/backups/shopify-docs.dump corepack pnpm backup:verify'
   ```

4. Restore into the database. This replaces current data:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml exec db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/shopify-docs.dump'
   ```

5. Start services again:

   ```bash
   docker compose --env-file .env.production -f compose.production.yaml up -d
   ```

## Operational Notes

- No application service is directly exposed except Caddy.
- PostgreSQL is internal to the Docker network and has no host `ports` mapping.
- Model API keys are configured after login in `/admin`; they are stored encrypted and only a key hint is shown.
- If translation costs need to pause, disable both providers in `/admin`; cached pages remain readable.
- Before changing `MODEL_KEY_ENCRYPTION_KEY`, follow the key-rotation steps in `docs/translation-operations.md`.
