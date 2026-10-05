# SpecForge (Docker local harness)

This folder is a **local test harness** for [Monotoba/specforge](https://github.com/Monotoba/specforge). Upstream does not ship official Docker docs; sdoc-intake adds this setup so Dan can run the SpecForge daemon and web UI without installing Python on the host.

The image **clones a pinned upstream release at build time** (default `v0.21.1`) and installs `specforge-tools` (CLI + daemon only — no PySide6 desktop studio).

## Quick start

```bash
cd specforge
cp .env.example .env   # optional: edit ports and API keys
docker compose up --build
```

Open the web UI: **http://localhost:8765/ui** (or `http://localhost:${SPECFORGE_HOST_PORT}/ui` if you changed the host port).

Health/status (no project required): **http://localhost:8765/** returns `{"service":"specforge-daemon","status":"ok"}`.

## Project data on the host

SpecForge stores everything in a **project directory** (Markdown artifacts, `.specforge.yaml`, trace DB, etc.).

**Always** create, init, and open projects under **`/projects/<name>`** inside the container. On the host that is **`specforge/projects/<name>`** (relative to this folder: `./projects/<name>`).

The web UI “Open project” accepts an arbitrary path. If you open or init under **`/home/specforge/...`**, a relative path like `./my-app`, or anywhere outside `/projects`, files land in the container’s writable layer and **do not** appear under `./projects/` on the host. The image sets **`WORKDIR /projects`** so CLI defaults and file pickers start in the mounted volume; still type an absolute path such as **`/projects/demo`** when opening in the UI.

| Host path | Container path | Purpose |
|-----------|----------------|---------|
| `./projects/` | `/projects` | Create or copy SpecForge projects here |
| `./config/` | `/config` (read-only) | Optional shared config snippets to copy into a project |

After the stack is up, initialize a new project inside the container:

```bash
docker compose exec specforge specforge init /projects/my-app --name "My App"
# optional git scaffold:
docker compose exec specforge specforge init /projects/my-app --git
```

Then in the web UI, open **`/projects/my-app`** (not `/home/specforge/...`), or `POST /projects/open` with `{"path":"/projects/my-app"}`.

You can also run one-off CLI commands without a long-lived exec shell:

```bash
docker compose run --rm specforge specforge status /projects/my-app
```

Set `SPECFORGE_PROJECT` in `.env` to your usual in-container path. Default **`/projects`**; after `init`, point at a subfolder (e.g. **`/projects/demo`**) so CLI examples and docs match what you open in the UI.

## Environment variables

Copy `.env.example` to `.env`. Compose loads `.env` when present (`env_file`, optional).

| Variable | Required | Description |
|----------|----------|-------------|
| `SPECFORGE_HOST_PORT` | No (default `8765`) | Host port published to the daemon |
| `SPECFORGE_REF` | No (default `v0.21.1`) | Git tag/branch cloned **at image build** (`docker compose build`) |
| `SPECFORGE_DEV` | No | `1` / `true` enables uvicorn `--reload` (limited use unless you rebuild the image) |
| `SPECFORGE_PROJECT` | No | Default in-container project root for docs/CLI (e.g. `/projects/my-app`) |
| `ANTHROPIC_API_KEY` | For Anthropic LLM | Used when `.specforge.yaml` has `llm.provider: anthropic` |
| `OPENAI_API_KEY` | For OpenAI LLM | Used when provider is `openai` |
| `OLLAMA_BASE_URL` | For Ollama | Set in `.specforge.yaml` as `llm.base_url` (e.g. `http://host.docker.internal:11434`) |

LLM settings can also live in each project's `.specforge.yaml`; see upstream configuration docs.

## Ollama on the host

If Ollama runs on your machine, point the project config at the host gateway, for example:

```yaml
llm:
  provider: ollama
  model: llama3.2
  base_url: http://host.docker.internal:11434
```

On Linux, you may need `extra_hosts: ["host.docker.internal:host-gateway"]` on the service (not enabled by default here).

## Implementation notes

- Upstream `specforge-daemon` binds **127.0.0.1**; this compose file runs **uvicorn on `0.0.0.0:8765`** so the published port works from the host.
- Image base: `python:3.12-slim`, non-root user `specforge` (uid 1000), **`WORKDIR /projects`** (owned by uid 1000, bind-mounted from `./projects`).
- `HEALTHCHECK` hits `GET /` inside the container.

## Rebuild after changing upstream pin

```bash
SPECFORGE_REF=v0.21.1 docker compose build --no-cache
docker compose up
```
