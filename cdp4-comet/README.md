# CDP4-COMET Community Edition

Standalone. This folder does not read or write sdoc-intake data.

```bash
cd cdp4-comet
docker compose up -d --force-recreate
```

Open http://localhost:8080 and sign in as `admin` / `pass`. Do not type a server address. The web app is Blazor Server, so it calls the API from inside the container at `http://comet-webservices:5000`. `http://localhost:5000` from that container is not the API, which is why the browser never shows the call. Opening http://localhost:5000 yourself still shows the API landing page.

`docker compose down` stops it. Add `-v` to delete the database volume.
