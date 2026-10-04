# sdoc-intake (monorepo)

This repository is a pnpm workspace. Root scripts (`pnpm dev`, `pnpm build`, `pnpm test`, `pnpm build:cli`, `pnpm publish:cli`, and the rest) delegate to the packages below.

| Path | Role |
| --- | --- |
| [`packages/intake`](packages/intake) | Local StrictDoc `.sdoc` editor and `sdoc-intake` CLI (today’s product). |
| [`cdp4-comet`](cdp4-comet) | Optional Comet/CDP stack notes (not started by default). |

Planned later as sibling packages (not scaffolded yet): Rust API, Postgres-backed services, DevOps extension.

Editor development, sample data, and CLI publishing are documented in [`packages/intake/README.md`](packages/intake/README.md).

## License

MIT. Copyright (c) 2026 Dan Raby.
