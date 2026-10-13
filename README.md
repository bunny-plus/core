# bunny.plus

Cloudflare API credentials are named `CF_ACCOUNT_ID` and `CF_TOKEN`. They are
encrypted in dotfiles' `bunny-plus-cloudflare.sops.yaml`; the backend deployment
requires both keys from its `bunny-plus-cloudflare` Secret. Recording cleanup
uses this token, with Stream Edit permission. The Stream signing JWK remains
separate and only signs playback links. Local token files stay private and are
ignored by Git. Never remove a supplied token file without the user's request.

The backend can run a Discord bot with `/login` in `DISCORD_GUILD_ID`. Its reply is
ephemeral and contains a single-use sign-in button that expires after 10 minutes.
Requesting another link replaces the previous one. Opening the button signs into
the website without Discord browser OAuth. Membership and roles are checked when
the link is issued, when it is redeemed, and hourly for the resulting session.

Configure `DISCORD_BOT_TOKEN` as a backend secret, or use
`DISCORD_BOT_TOKEN_FILE=../discord-token` for local development. Install the bot in
the configured guild with the `bot` and `applications.commands` scopes; it does
not need message-reading permissions or privileged intents. The backend upserts
only `/login` on startup. Leave the application's Interactions Endpoint URL empty
so commands arrive over the Gateway. Production credentials live encrypted in
dotfiles' `bunny-plus-discord.sops.yaml` and are loaded from the
`bunny-plus-discord` Kubernetes Secret.

Login credentials are random, stored only as hashes in the persistent session
database, and passed in a URL fragment that the login page removes before
redeeming with a same-origin-checked POST. They never contain Discord bot or OAuth
credentials. The existing browser OAuth sign-in remains available.

Persistent backend data can live in one D1 database: sessions, Discord login
links, chat history, screenings, viewing progress, tickets, artwork and migration
records. Browser settings such as volume stay on the device. With
`D1_DATABASE_URL` and `D1_DATABASE_SECRET` configured, the backend uses D1 for all
these stores and stops startup if D1 is unavailable. With both unset, local
development continues to use the existing three SQLite files.

`storage-worker/index.ts` is a small authenticated bridge from the existing Node
backend to D1's native binding. It exposes only `POST /query`, requires a bearer
secret, and has no browser CORS access. The app and Discord bot keep running on
the existing backend. The Cloudflare deployment token is needed for provisioning
only; the running backend uses the separate shared secret. Atomic batches keep
login redemption single-use and ticket awards consistent. Writes are not
automatically retried after a network failure.

To provision it, run these commands inside `nix develop` with Cloudflare account
credentials supplied through the environment:

```sh
pnpm exec wrangler d1 create bunny-plus --config wrangler.database.jsonc
```

For a new account, update `database_id` in `wrangler.database.jsonc` with the
returned ID. This checkout already points to the existing database's `db`
binding. Generate a random 32-byte base64url secret, save it in your secret
manager, and supply the same value as the Worker's `DATABASE_SECRET` and the
backend's `D1_DATABASE_SECRET`. Do not commit it or place it in frontend config.

```sh
pnpm exec wrangler d1 migrations apply bunny-plus --remote --config wrangler.database.jsonc
pnpm exec wrangler secret put DATABASE_SECRET --config wrangler.database.jsonc
pnpm exec wrangler deploy --config wrangler.database.jsonc
```

Set `D1_DATABASE_URL` to the resulting Worker's HTTPS URL followed by `/query`.
The endpoint is reachable over HTTPS, but every query requires authentication.
Keep the backend's URL and secret together in encrypted deployment secrets.

For the production cutover, stop the backend so it cannot change any of the
three source databases, and retain a backup including SQLite WAL files. Mount
the existing `/app/data` volume for the import, then first inspect row counts:

```sh
pnpm database:import --from /path/to/data
pnpm database:import --from /path/to/data --apply
```

The import reads `sessions.sqlite`, `chat.sqlite` and `cinema.sqlite`, checks D1's
row-size limit, copies in bounded batches, and verifies every row and blob. It
refuses an occupied destination. An interrupted import can resume using the same
unchanged source snapshot; a different snapshot is refused. No session or login
credential values are printed. In the backend container, use
`node migrate-data.cjs --from /app/data --apply` with the D1 settings supplied
to that one-off process. Only after verification should the deployment receive
both D1 settings and restart. Keep the old volume for recovery; once D1 receives
new writes, switching back to the old files would lose those writes.

The Kubernetes import job is prepared in `ops/database-import-job.yaml`. It uses
the `bunny-plus-database` Secret in `default`, keeps a private snapshot on the
existing volume, runs preflight, imports, and verifies all rows. Supply the newly
published backend image by digest. Before running it, suspend the Flux
`applications` reconciliation, scale `bunny-plus` to zero, and wait for its pods
to disappear. The import job must be the only process accessing the source data.

```sh
kubectl -n flux-system patch kustomization applications --type=merge -p '{"spec":{"suspend":true}}'
kubectl -n default scale deployment bunny-plus --replicas=0
kubectl -n default wait --for=delete pod -l app=bunny-plus --timeout=180s
kubectl set image --local -f ops/database-import-job.yaml import="$BUNNY_IMAGE" -o yaml | kubectl apply -f -
kubectl -n default wait --for=condition=complete job/bunny-plus-database-import --timeout=1800s
kubectl -n default logs job/bunny-plus-database-import
```

After a successful verified import, set the backend image to the same digest and
load `bunny-plus-database`, `bunny-plus-cloudflare` and `bunny-plus-discord` secret
keys into its environment. Remove the old `STREAM_RECORDING_CLEANUP_*` variables,
scale back to one replica, and verify readiness. Update dotfiles' image digest,
include `bunny-plus-database.sops.yaml` in its kustomization, and add required
`D1_DATABASE_URL` / `D1_DATABASE_SECRET` references before resuming Flux. Its Git
configuration must match the running deployment so reconciliation preserves D1.
If import fails, keep the backend stopped and resume from the retained snapshot;
the importer deliberately refuses a different source after a partial import.

Cloudflare's free plan currently allows 500 MB per D1 database, 5 million rows
read and 100,000 rows written per day. Index maintenance also counts as writes.
Viewing progress stops writing once a viewer reaches the ten-minute ticket
threshold. Ticket image uploads are capped at 1.9 MB to fit the 2 MB row limit;
an existing oversized image will fail import preflight instead of being lost.
See the official [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
and [limits](https://developers.cloudflare.com/d1/platform/limits/).
