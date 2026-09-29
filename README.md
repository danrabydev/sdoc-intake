# SDoc Intake

Local editor for a StrictDoc `.sdoc` tree. Change UID, title, statement, and relations in a table. Every save is validated first. Invalid SDoc is never written.

There is no database and no sign-in. Documents stay as files on disk.

## Run without cloning

After the package is published:

```sh
npx sdoc-intake
npx sdoc-intake ./requirements
npx sdoc-intake ./requirements/SYS.sdoc --port 4173
```

The path is a directory of `.sdoc` files, or one `.sdoc` file. A file opens in the editor and its folder is the document root, so sibling documents stay visible. With no path, the current directory is the root. The editor listens on `http://127.0.0.1:4173`.

Requires Node 22 or newer.

Publish the staged, dependency-free package (this does not publish the preview app):

```sh
pnpm publish:cli
```

## Develop this repo

```sh
pnpm install
pnpm dev
pnpm build:cli
pnpm exec sdoc-intake ./data
```

`pnpm dev` reads `./data` unless `SDOC_ROOT` is set. See `.env.example`.

`SDOC_STRICTDOC_BIN` is an optional second check with the StrictDoc CLI. The app does not require it. That check runs only in server mode.

## Browser folder

Host `dist/client/sdoc-intake.html` from `pnpm build:cli` as a static site, with no API and no other files. If `/api/health` does not answer, the page uses a folder on the visitor's computer (Chrome or Edge). Open it over http or https. A `file://` page cannot ask for a folder. The header flag switches **Server** and **This computer**. `?mode=browser` or `?mode=server` forces one, and the choice is remembered in that browser.

Invalid SDoc is still refused before a write. The page can only see the folder the visitor picked.


## License

MIT. Copyright (c) 2026 Dan Raby.
