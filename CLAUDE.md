# CLAUDE.md

Shared services for every app on the Pi, plus the www.khoe.dev landing page (`home/`) and the
"Container Health" umbrelOS app (`localinfra-health/`). Workspace rules (branching, `DOCKER_CONTEXT`, security, service list):
`../CLAUDE.md`. Full docs: `README.md` (setup, backups, LLM gateway `llm/server.mjs`, widget) and
`DEPLOYING-APPS.md` (how any app is deployed).

## Commands

```bash
./deploy.sh [service...]                              # apply changes on the Pi, wait for healthy
./deploy.sh --health                                  # release Container Health (checks, version bump, git push)
DOCKER_CONTEXT=umbrel docker compose ps
DOCKER_CONTEXT=umbrel docker compose logs -f <service>

# Docker Desktop on the Mac (local dev for the apps)
EXTERNAL_ROOT=$PWD BACKUP_DIR=$PWD/backups-local S3_DATA_DIR=$PWD/s3-local DOCKER_CONTEXT=desktop-linux docker compose up -d --build

scripts/provision-app.sh <app_name> <path/to/app> [--no-redis] [--s3] [--llm] [--metrics]  # new app + writes its .env
scripts/new-project.sh <name>        # provision only, prints the env
scripts/bootstrap-pi.sh              # first deploy from the Mac
scripts/check-health-app.sh          # before releasing the Container Health app
```

## Rules to keep

- `./deploy.sh` recreates only containers whose definition changed; apps keep running.
- **No `./file` bind mounts** in `compose.yml`: it is deployed from the Mac, so relative paths would
  point at the Mac. Use volumes or absolute Pi paths (`BACKUP_DIR`, `S3_DATA_DIR`).
- **The drive is mounted via its parent (`EXTERNAL_ROOT`, `rslave`), never by its own path**: if
  Docker starts before umbrelOS mounts the drive it would create a root-owned folder there, and
  umbrel then mounts the drive as `SSD_RAID1 (2)`. `s3/start.sh` waits for its marker file;
  `backup/entrypoint.sh` links `/backups`.
- **Marker files guard the external drive** (`.localinfra-backup-target`, `.localinfra-s3-target`).
  Containers refuse to start without them so the SD card never fills. Don't bypass them.
- **Keep new services consistent with the per-project isolation** (own role/DB, ACL user, bucket, LLM key).
- The SSH alias `umbrel-docker` uses `ControlMaster no` (a shared connection once hung a deploy
  mid-way). Don't change it to share connections.
- Services publish on the Pi's loopback only; reach them by SSH tunnel. The tunnel reaches apps by
  container name.
- `.env` holds real secrets (Postgres/Redis admin, OpenRouter key, tunnel token); `.env.example` is
  the template.
- Postgres major upgrades need backup → remove volume → restore (README "Notes"), not an in-place bump.
