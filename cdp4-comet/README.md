# CDP4-COMET Community Edition

Standalone. This folder does not read or write sdoc-intake data.

```bash
cd cdp4-comet
docker compose up -d
```

Open http://localhost:8080. At the login screen set the server to http://localhost:5000. The seeded account is `admin` / `pass`.

The API is published on port 5000 because the browser talks to it directly. Postgres stays on the compose network. The database superuser is `postgres` / `pass`; the services use the image's `cdp4` role. RabbitMQ is omitted because the image ships with the message broker disabled.

`docker compose down` stops it. Add `-v` to delete the database volume.
