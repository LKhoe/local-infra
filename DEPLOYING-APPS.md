# Deploying an app on the Pi

The one way every app is deployed on the Raspberry Pi (umbrelOS): from the Mac, through the
`umbrel` Docker context, on local-infra's shared services. Follow the same steps for every new
app. Reference implementation: **my-recipes**.

```
 Mac (repo + .env)                          Raspberry Pi
 ./deploy.sh ── docker context "umbrel" ──► build image, run container <app>
                                              ├─ localinfra_postgres → db + role <app_name>
                                              ├─ localinfra_redis    → ACL user, keys "<app_name>:*"
                                              ├─ localinfra_s3       → bucket <app-name> + key
                                              ├─ localinfra_llm      → LLM key, limits on paid calls
                                              ├─ localinfra_metrics  → metrics key (anonymous usage metrics)
                                              └─ localinfra_tunnel   → Cloudflare tunnel → https://<app>.<domain>
```

Nothing is cloned or copied to the Pi by hand. local-infra backs up every database nightly and
the Container Health widget shows the app as soon as it runs.

---

## The app contract

What every app needs before it can be deployed. The templates in
[`templates/app/`](templates/app) already follow it.

| | Rule | Why |
|---|---|---|
| 1 | `docker-compose.yml` has **one service**; `container_name`, service name and image name are the app name (kebab-case), image tag `:latest` | `deploy.sh` reads everything from compose and keeps `<app>:previous` for rollback |
| 2 | **No database, Redis or file volume of its own**: data goes to local-infra Postgres / Redis / S3. **No LLM API key of its own**: LLM calls go to local-infra's gateway | one place to run, back up, monitor and pay for |
| 3 | **No bind mounts** (`./file:/path`) | compose runs on the Mac, the paths would be looked up on the Pi |
| 4 | Joins local-infra's networks as **external** networks, plus `localinfra_tunnel` if public | the tunnel and the shared services are reachable by container name |
| 5 | A **healthcheck** on `GET /api/health` that checks the app's dependencies (DB, bucket, ...) | `deploy.sh` waits for it; the widget turns red when it fails |
| 6 | A **unique host port** from the table below, container port 3000, **published on the Pi's loopback only** (`127.0.0.1:<port>:3000`) | handy for checks from the Pi or an SSH tunnel without exposing the app to the LAN; two apps can't share a port. The tunnel doesn't use it: it reaches the app by container name (`http://<app>:3000`) |
| 7 | A **memory limit** (512M default) and json-file log rotation | the Pi also runs umbrelOS and its apps |
| 7b | **Hardened container**: `cap_drop: [ALL]`, `no-new-privileges`, `read_only: true` with tmpfs for `/tmp` and `/app/.next/cache` (uid/gid 1001, nextjs) | a compromised app can't escalate or persist anything on disk. If the app writes elsewhere (`EROFS: read-only file system` in the logs), add a `tmpfs` entry for that path in the app's compose; it is wiped on restart, so durable data goes to Postgres / S3 |
| 8 | The container **migrates on start** (entrypoint: wait for Postgres → migrate → start) | no manual step after a deploy |
| 9 | The runner image is the **Next.js standalone output only** (no `npm ci` in the runner); entrypoint scripts are bundled with esbuild in the builder, and anything native (sharp) comes from the build's lockfile install, never `npm install <pkg>` | `npm ci --omit=dev` in the runner adds ~700 MB of node_modules; a bare install re-resolves every dependency and native modules (sharp) end up with mismatched versions |
| 10 | **`.env` = the Pi, `.env.local` = local dev**, both git-ignored together with `.env.bak-*` | compose reads `.env` on the Mac; Next.js and dev scripts let `.env.local` win |
| 11 | Redis keys/channels start with `REDIS_KEY_PREFIX`; S3 uses path-style requests, region `garage`; the bucket is never exposed, the app serves its files itself; LLM calls ask for a tier (`simple`/`medium`/`hard`) and handle `429` | local-infra's isolation rules (README section 4) |

### Port table

| Port | App |
|---|---|
| 3000 | yarg-aggregator |
| 3001 | my-recipes |
| 3002 | sports-cal |
| 3003 | brain-gym |
| 3004 | doc-extractor |
| 3005 | *next free* |

Add the app here when you pick its port. Host ports are bound to the Pi's loopback
(`127.0.0.1`), so they are not reachable from the LAN: use them from the Pi itself or an SSH
tunnel (`ssh -N -L 8080:127.0.0.1:<port> umbrel@umbrel.local`, then `http://localhost:8080`).

---

## Steps for a new app

Prerequisites, once per Mac: SSH key login and the `umbrel` Docker context on the
`umbrel-docker` SSH alias, which never shares connections (README section 1), and local-infra
running on the Pi.

### 1. Prepare the repo (once)

Copy from `templates/app/` into the app repo and replace `myapp` / `30XX`:

| Template | Goes to | Change |
|---|---|---|
| `docker-compose.yml` | repo root | app name, port, drop unused local-infra blocks, add the app's env vars |
| `deploy.sh` | repo root | nothing (same file in every app) |
| `Dockerfile`, `docker-entrypoint.sh`, `scripts/migrate.mjs` | same paths | only for a Next.js + Drizzle app; otherwise write your own that keeps rules 8–9. Needs `esbuild` as a devDependency (`npm i -D esbuild`); add each extra `scripts/*.mjs` (seeds) to the Dockerfile's `esbuild` command. See [Image size](#image-size-and-sharp) |
| `app/api/health/route.ts` | same path | add the app's other dependencies |
| `lib/metrics/`, `components/metrics.tsx`, `app/api/metrics/route.ts` | same paths | optional, anonymous usage metrics: add `<Metrics />` to the root layout and `onRequestError` to `instrumentation.ts` |
| `.env.example` | repo root | the app's own settings |

`.gitignore` must contain:

```
.env
.env*.local
.env.bak-*
```

Add the app to the port table above.

### 2. Provision on local-infra and write `.env` (once)

```bash
DOCKER_CONTEXT=umbrel ../local-infra/scripts/provision-app.sh <app_name> <path/to/app> [--no-redis] [--s3] [--llm] [--metrics]
```

An app that already exists and only needs the LLM key:
`provision-app.sh <app_name> <path/to/app> --no-postgres --no-redis --llm` (then `./deploy.sh`), and the
same with `--metrics` for the metrics key (README section 4, "Metrics").

`<app_name>` uses `_`, not `-` (`my_recipes`): it names the database, the role and the keys.
The script creates them, writes the credentials into the app's `.env` (from `.env.example` if
missing; the old file is kept as `.env.bak-<time>`) and **lists every value still local or a
placeholder**. Fill those in: the public URL, `PORT`, secrets (`openssl rand -base64 32`),
OAuth/API keys. Local-dev values go to `.env.local`, not `.env`.

### 3. Public access (once, manual)

The Container Health page (Umbrel → Container Health → Open) has these as step-by-step guides,
with the values for the app filled in and a copy button on each.

- **Cloudflare Zero Trust → Networks → Tunnels** → the local-infra tunnel (`localinfra-tunnel`) → *Published application
  routes*: add the public hostname, service `HTTP`, URL `<app>:3000`.
- **OAuth providers** (Google, ...): add `https://<hostname>/api/auth/callback/<provider>` as a
  redirect URI.
- **Alexa skill** (optional): a custom skill whose HTTPS endpoint is the app itself, at the URI in
  its `skill.json` (`/api/alexa`; `/api/alexa/skill` in my-recipes), with the *wildcard
  certificate* option, then `ALEXA_SKILL_ID` in `.env`. Details in the app's README.
- **Home page** (public apps): add a card for the app to `home/site/index.html` (and its icon to
  `home/site/icons/`), then `./deploy.sh home` from the local-infra folder (README, "Home page").

### 4. First deploy

```bash
./deploy.sh
```

It checks the target, the external networks and `.env` (warns about leftover local values and
uncommitted changes), builds the image on the Mac (`linux/arm64` with Docker Desktop, no emulation on Apple Silicon),
loads it into the Pi with `docker save | docker load` (about a minute), restarts the container and
waits until it's healthy. `DEPLOY_BUILD=remote ./deploy.sh` builds on the Pi instead (3–5 minutes). Then the app's own first-run step, if any (first admin, invite code, seed).

Moving existing data in, **before** the first deploy so migrations don't create empty tables first:

```bash
DOCKER_CONTEXT=<old context> docker exec <old-postgres> pg_dump -U <user> -Fc <db> > app.dump
DOCKER_CONTEXT=umbrel docker exec -i localinfra-postgres pg_restore -U <app_name> -d <app_name> --no-owner --no-acl < app.dump
```

Files into S3: through an SSH tunnel to the Pi's S3 port (my-recipes'
`scripts/upload-photos-to-s3.mjs` is an example):

```bash
ssh -N -L 13900:127.0.0.1:3900 umbrel@umbrel.local    # S3_ENDPOINT=http://localhost:13900
```

### 5. Check

```bash
ssh umbrel@umbrel.local 'curl -s http://127.0.0.1:<port>/api/health'   # {"status":"ok"}; host ports are loopback-only
DOCKER_CONTEXT=umbrel docker compose ps                        # (healthy)
DOCKER_CONTEXT=umbrel docker compose logs -f <app>
```

Then open the public URL, sign in, and exercise what the health check can't (an upload, an
email, a background job).

---

## Every deploy after that

```bash
./deploy.sh              # deploy the working tree
./deploy.sh --release    # bump the patch version, commit and push, then deploy
./deploy.sh --rollback   # back to the image that was live before the last deploy
```

Only the app's container is rebuilt; local-infra and the other apps keep running. Rollback
restores the code, not the database: a migration that already ran stays applied.

## Rotating credentials

```bash
DOCKER_CONTEXT=umbrel ../local-infra/scripts/provision-app.sh <app_name> <path/to/app> [same flags] --rotate
./deploy.sh
```

New passwords/keys, same data. The app is down between the two commands.

## Removing an app

```bash
DOCKER_CONTEXT=umbrel docker compose down          # in the app repo: container only
```

Then its data on local-infra (irreversible), README section 4, "Removing a project". Remove the
tunnel hostname and the port table row.

## Local development

Run local-infra on Docker Desktop (README section 7), then provision the app there and point
`.env.local` at `localhost`:

```bash
DOCKER_CONTEXT=desktop-linux scripts/new-project.sh <app_name> [--no-redis] [--s3]   # prints the values
```

Use them in `.env.local` with `localhost` instead of the container names
(`localinfra-postgres` → `localhost:5432`, `localinfra-s3:3900` → `localhost:3900`).
Never run `provision-app.sh` against Docker Desktop for an app whose `.env` holds the Pi config.

### Image size and sharp

The runner stage copies only `.next/standalone`, `.next/static`, `public/`, the migrations and the
esbuild bundles of the entrypoint scripts (`scripts/*.mjs` become self-contained files, so
`drizzle-orm` and `pg` need no `node_modules` at runtime). A Next.js + Drizzle app is then around
250 MB instead of 1 GB. If an app's script imports something that can't be bundled, add it with
`--external:<pkg>` and copy that package from the builder (like sharp below).

sharp is a native module that standalone tracing usually includes (Next 15+). To check, after
`RUN npm run build` in the builder run `ls .next/standalone/node_modules/sharp
.next/standalone/node_modules/@img`; or build the image and run
`DOCKER_CONTEXT=desktop-linux docker run --rm --entrypoint ls <app>:latest node_modules/@img`.
If either is missing, uncomment the two `COPY --from=builder … sharp` / `@img` lines in the Dockerfile.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Network localinfra_… not found` | local-infra isn't running on that context, or the app joins a network it wasn't provisioned for |
| `Bind for 0.0.0.0:<port> failed` | port taken: pick the next free one from the table |
| `password authentication failed` / S3 `403` / Redis `NOPERM` | `.env` doesn't match local-infra: rotate (above) |
| `Error loading shared library libvips-cpp.so…` or `Cannot find module 'sharp'` | rule 9: the standalone output lacks sharp or has a mismatched libvips: uncomment the two `COPY … node_modules/sharp` / `@img` lines in the Dockerfile (copied from the builder's lockfile install) |
| `EROFS: read-only file system` / `EACCES` on a path under `/app` or `/tmp` | rule 7b: the app writes outside the tmpfs mounts: add a `tmpfs` entry (`/path:uid=1001,gid=1001`) to its compose |
| Sign-in redirects to the wrong host | the public URL in `.env` is wrong; `NEXT_PUBLIC_*` needs a rebuild |
| docker commands to the Pi hang | the `umbrel` context is sharing an SSH connection: point it at the `umbrel-docker` alias (README section 1). Unstick it now with `ssh -O exit umbrel.local` |
| A deploy stopped mid-way and the app is down | `DOCKER_CONTEXT=umbrel docker ps -a --filter name=<app>`: remove a leftover `<id>_<app>` container (`docker rm`), then `DOCKER_CONTEXT=umbrel docker compose up -d --no-build <app>` starts the new image. `./deploy.sh --rollback` goes back to the previous one instead |
