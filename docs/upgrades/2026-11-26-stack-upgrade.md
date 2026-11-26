# Stack upgrade, 2026-11-26

Every service in local-infra was moved to its current version in one day, including two major
upgrades (Postgres 17 → 18, Redis 7.4 → 8.12). This file records how it went and what to do
better next time. The reusable procedure for a Postgres major upgrade is the README runbook
("Upgrading Postgres to a new major version"); this is the story around it.

## What changed

| Service | Before | After | Kind |
|---|---|---|---|
| Postgres (+ backup image) | 17.11 | 18.7 | major: dump → new volume → restore |
| Redis | 7.4.11 | 8.12.0 | major: in place (8.x reads 7.4 RDB/AOF) |
| Garage (S3) | v2.4.1 | v2.6.0 | minor, in place |
| Ollama (LLM) | 0.35.1 | 0.40.18 | minor, in place |
| cloudflared | 2026.11.1 | 2026.11.2 | patch |
| nginx-unprivileged (home) | 1.28.2 | 1.30.6 | 1.28 was out of support since 2026-04 |
| alpine (s3 runtime) | 3.22 | 3.24 | base image |
| Node (llm, metrics, app template, Container Health) | 24 | 26 LTS | major runtime |
| postgres.js (metrics) | 3.4.9 | 4.1.1 | major, no code change needed |
| socket-proxy (Container Health) | 1.13.2 | 1.14.0 | minor, pinned by digest |
| Container Health | 1.6.0 | 1.7.1 | 1.7.0 = images above, 1.7.1 = Garage backup card |

Plus one fix found on the way: Garage's own metadata snapshots had never worked (see below).
They are off now and the nightly backup takes the snapshot instead (`backup/backup-garage.sh`).

## How it was done

1. **Inventory.** Pins in `compose.yml`, Dockerfiles and `.env.example` compared with Docker Hub,
   GitHub releases and endoflife.date, and with what the Pi actually ran (`docker compose ps`,
   `postgres --version`, `redis-server --version`). The Pi's `.env` pins versions too and is what
   decides; it was already ahead of `.env.example` for cloudflared.
2. **Three branches**, so the risky ones could ship alone: `claude/stack-updates` (everything
   in place), `claude/redis-8`, `claude/postgres-18`. Each was built in its own worktree by a
   Sonnet subagent and tested on the Mac's Docker Desktop with throwaway containers:
   - Garage 2.6.0 opened data written by 2.4.1, and 2.4.1 opened it again (rollback works).
   - Redis 8.12 loaded 7.4 data and ACLs; BullMQ ran with a least-privilege user.
   - Postgres: a full 17 → 18 dump/restore rehearsal (owners, ACLs, scram passwords).
3. **Review, then merge.** Only conflict: the README services table.
4. **Deploy on the Pi**, in this order:
   - Preparation, no downtime: fresh `backup.sh`; restore rehearsal of that set into a throwaway
     `postgres:18-alpine` on the Pi (`--network none`); Redis data copied to the Mac
     (`docker exec ... tar` streamed out); `.env` backed up, then only its `*_VERSION` lines
     changed; all images pulled and built ahead (`docker compose build`, no restarts).
   - Window (09:25 → 09:29 local, about 5 minutes with sports-cal, my-recipes, yarg-aggregator and
     metrics down): record roles/databases, stop the Postgres clients, final dump,
     `PG_ALLOW_INIT=1 ./deploy.sh postgres backup`, restore, compare roles/owners/ACLs/password
     types, Garage metadata copied offline while S3 was stopped, `./deploy.sh redis s3 llm metrics`,
     start the apps, check their logs (all migrated and healthy), first backup on 18.
   - After: `./deploy.sh home tunnel`; Container Health released by the push to `main`.
5. **Garage snapshot fix** as a follow-up branch, deployed with `./deploy.sh s3 backup` and run once.

Rollback material kept: the Postgres 17 volume `localinfra_postgres_data` on the Pi, and on the
Mac (git-ignored) `backups-local/pre-upgrade-2026-11-26/` (Redis data, Garage metadata, role and
database lists) and `.env.bak-2026-11-26`.

## What we found

**Breaking changes the release notes alone would not have caught** (all fixed before the deploy):

- **Postgres 18 image layout.** `PGDATA` moved to `/var/lib/postgresql/18/docker` and the image's
  `VOLUME` to `/var/lib/postgresql`. Keeping the old mount (`.../data`) would have put the data in
  an anonymous volume, lost on the next recreate. New mount and a new volume name (`pgdata`).
- **A stale `PG_VERSION` would start an empty database.** With the new layout, a 17 image (or any
  wrong version) finds no cluster and initialises an empty one; the apps would then migrate into
  it. Two guards now: `deploy.sh` refuses while `PG_VERSION` < 18, and the container refuses to
  initialise unless `PG_ALLOW_INIT=1` is set for that one start.
- **`pg_restore --no-owner` breaks the isolation.** With `--create` it leaves every database owned
  by `postgres` and drops the `REVOKE ... FROM PUBLIC`. The runbook restores without it.
- **Redis 8 would not have started.** The 8.x entrypoint no longer chowns `/data` when it holds
  files it doesn't know, and `users.acl` is one, so Redis could not read its ACL file.
  `redis/start.sh` now chowns it.
- **Redis 8 loads four modules by default** (search, JSON, time series, Bloom): memory on a 384M
  limit, and their commands reachable by project users. Removed in `redis/Dockerfile`.
- **New Redis commands outside `-@admin`** (`TRIMSLOTS`, `BLESS`): denied for new project users,
  and for the existing `yarg` user by hand (`ACL SETUSER yarg -trimslots -bless`, `ACL SAVE`).

**Found on the Pi:**

- **Garage snapshots never worked.** Garage names them with the time (`2026-11-26T12:46:33Z`);
  exFAT refuses `:` in file names, so every 6-hourly snapshot failed with "Invalid argument" and
  nobody noticed, because the error only shows in `docker logs localinfra-s3`.
- **The nightly backup covers Postgres and Home Assistant only.** Redis (BullMQ state, ACL users)
  and, until this upgrade, Garage's metadata had no copy. Garage now has one; Redis still doesn't.
- **The upgrade itself went to plan.** Restore rehearsal: all 4 databases. Real restore: roles,
  owners, ACLs and scram hashes identical; apps logged in with their existing passwords.

**Side effects to know about:**

- Once the Postgres change was on `main`, `./deploy.sh` refused to deploy *any* local-infra
  service until the migration was done. Right for safety, but it ties unrelated services to it.
- `PG_ALLOW_INIT` is part of the postgres service definition, so the next deploy without it
  recreated Postgres once more (a few seconds). Harmless, but unexpected the first time.
- Pushing `main` also releases Container Health (umbrelOS reads the default branch), so the
  merge doubled as its release.
- The Mac dev stack's Postgres also starts on the new, empty volume and refuses to start until
  it gets `PG_ALLOW_INIT=1` or a restore.

**Not verified:** Ollama release notes 0.36 to 0.40.14 and Garage's release notes could not be
fetched (pages too large, or automated fetches blocked); the data tests stood in for them.

## What to improve next time

Ordered by how much they would have saved.

1. **Back up Redis nightly.** Its volume is small (27 MB) and held BullMQ jobs and the ACL users
   with no copy anywhere. A `backup-redis.sh` beside the Postgres and Garage jobs (an RDB from
   `BGSAVE`, or a copy of the AOF directory) would have replaced the manual tar.
2. **Script the Postgres major upgrade.** The runbook worked but is about 30 commands typed by
   hand. A `scripts/pg-major-upgrade.sh` with the same steps, stopping at the first failed check
   (rehearsal, role/database diff, app logins), would make the next one (19) routine. Generate the
   client list from the network, as the runbook does.
3. **A version check script.** `scripts/check-versions.sh` printing each pin, what the Pi runs, the
   latest upstream tag and the end-of-life date, i.e. step 1 of this file, which was done by hand.
   Optionally a monthly scheduled run that only reports.
4. **Prebuild in `deploy.sh`.** A `--build-only` mode (`compose build`, no `up`) so images are
   ready before a window, as was done by hand here.
5. **Scope the Postgres guard to the services it protects.** Refuse only when the deploy touches
   `postgres`, `backup` or a service that depends on them, so e.g. `./deploy.sh home tunnel` stays
   possible during a pending migration.
6. **Make `PG_ALLOW_INIT` not part of the service definition**, e.g. a marker file that the
   entrypoint reads and removes, so leaving the opt-in doesn't recreate Postgres.
7. **Surface errors that only live in logs.** The Garage snapshot failed silently for weeks.
   Container Health could flag containers with recent `ERROR` lines, or the backup job could check
   each service's own maintenance tasks.
8. **Pin exact versions in `.env`.** `PG_VERSION=17` and `REDIS_VERSION=7.4` float across patch
   releases, so what runs depends on when the image was last pulled. Pinning `17.11` / `7.4.11`
   makes the inventory exact and patch updates deliberate (the image tag then changes too).
9. **Release notes the agents can read.** Install `gh` on the Mac (`gh release view`), so release
   notes come from the API instead of web pages that are too large or block fetches.
10. **One source of truth for versions.** Defaults live in `compose.yml`, the Dockerfile `ARG`s and
    `.env.example`, and the real values in the Pi's `.env`; four places drifted apart. Keep the
    defaults in `compose.yml` only and let the Dockerfiles take them as build args with no default.

**Security notes to follow up:** project Redis users can list other projects' key names with
`KEYS`/`SCAN` (Redis doesn't apply key patterns to them; the values stay protected). Denying
`KEYS` and `SCAN` for project users would close it, if no app needs them (check BullMQ and the
apps first: test yarg-aggregator's queues with the stricter user before changing it).

## Still to do

- After a few days without problems: delete `localinfra_postgres_data` and the old images
  (README runbook step 9), then the Mac rollback files above. Until then no `docker volume prune`,
  `docker system prune --volumes` or `docker compose down -v` on the Pi.
- Update Container Health to 1.7.1 in the Umbrel UI.
- Mac dev stack: start the local Postgres once with `PG_ALLOW_INIT=1`, or restore the dev data.
