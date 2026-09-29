# SDoc Intake

Local editor for a StrictDoc `.sdoc` tree. Change UID, title, statement, and relations in a table. Every save is validated first. Invalid SDoc is never written.

Documents stay as files under `SDOC_ROOT` (default `./data`). There is no database and no sign-in.

## Run

```sh
pnpm install
pnpm dev
```

Optional environment (see `.env.example`):

```
SDOC_ROOT=./data
SDOC_WATCH=true
```

`SDOC_STRICTDOC_BIN` is an optional second check with the StrictDoc CLI. The app does not require it.

## License

MIT. Copyright (c) 2026 Dan Raby.
