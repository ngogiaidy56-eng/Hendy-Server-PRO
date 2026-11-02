# Hendy Server PRO V2

Telegram Bot backend on Cloudflare Workers with D1 persistence, Durable Objects WebSocket sessions, Queues for background jobs, R2 binding, protected webhook setup, and GitHub Actions CI/CD.

> **Security notice:** the previous version exposed a Telegram bot token in a public repository. Revoke that token with BotFather and issue a new one before using V2. Removing it from the latest source does not erase it from Git history.

## V2 scope

- Telegram webhook validates `X-Telegram-Bot-Api-Secret-Token` and rejects malformed updates.
- Telegram update IDs are stored in D1 to avoid duplicate processing; failed updates can be retried.
- User profiles, wallets, sessions, video jobs, payment requests, settings, and audit logs have durable D1 tables.
- `/health` is a liveness endpoint and `/ready` checks runtime bindings.
- `/set-webhook` and `/webhook-info` require `WEBHOOK_SETUP_KEY`.
- Admin settings API uses `ADMIN_API_TOKEN`; changes emit Durable Objects WebSocket events.
- WebSocket clients receive short-lived signed tickets from the admin API.
- Vietsub requests are queued. The queue consumer forwards them to the configured Core Backend; it marks work failed rather than pretending success when that backend is missing.
- Deposits and social-media services are deliberately not marked successful until a real provider and verified callback are integrated. No automatic wallet credit is implemented in this base release.

## 1. Requirements

- Node.js 22+
- npm
- Cloudflare account with Workers, D1, Durable Objects, Queues and R2 enabled
- A Telegram bot created with BotFather

## 2. Install

```bash
npm install
cp .dev.vars.example .dev.vars
```

Fill local secrets in `.dev.vars`; never commit this file.

Required secrets:

| Secret | Purpose |
| --- | --- |
| `BOT_TOKEN` | Telegram Bot API token |
| `WEBHOOK_SECRET_TOKEN` | Telegram webhook header secret; 1–256 chars, A-Z/a-z/0-9/_/- |
| `WEBHOOK_SETUP_KEY` | Protects webhook activation and inspection |
| `ADMIN_API_TOKEN` | Protects admin configuration API |
| `SOCKET_SIGNING_SECRET` | Signs short-lived WebSocket tickets |
| `INTERNAL_API_SECRET` | Protects internal Durable Object publish requests |
| `CORE_BACKEND_TOKEN` | Authenticates requests to the Vietsub backend (only if enabled) |

Set non-secret runtime variables in `wrangler.toml` or the Cloudflare dashboard:

- `ADMIN_IDS`: comma-separated Telegram numeric IDs.
- `MEDIA_ALLOWED_HOSTS`: comma-separated allowed HTTPS media hosts.
- `CORE_BACKEND_URL`: base URL of a real Core Backend supporting `POST /api/v1/vietsub/jobs`.
- `TELEGRAM_WEBHOOK_URL`: optional fixed public webhook URL.
- `SUPPORT_URL`: optional HTTPS support link.

## 3. Create Cloudflare resources

Run these commands after authenticating with `npx wrangler login`:

```bash
npx wrangler d1 create hendy-server-pro-db
npx wrangler queues create hendy-server-pro-jobs
npx wrangler r2 bucket create hendy-server-pro-assets
```

Copy the D1 `database_id` returned by Wrangler into `wrangler.toml` at `[[d1_databases]]`. Do not leave the zero UUID placeholder in production.

Apply the schema:

```bash
npm run db:migrate:remote
```

Durable Object `BotSocket` is declared in `wrangler.toml` with migration tag `v1`. Do not remove or reuse this migration tag for a different class migration.

## 4. Configure Worker secrets

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET_TOKEN
npx wrangler secret put WEBHOOK_SETUP_KEY
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put SOCKET_SIGNING_SECRET
npx wrangler secret put INTERNAL_API_SECRET
# only when Core Backend is deployed:
npx wrangler secret put CORE_BACKEND_TOKEN
```

Use independently generated high-entropy values for the setup/admin/signing secrets. Do not reuse the Telegram bot token as another secret.

## 5. Local verification

```bash
npm run check
npx wrangler d1 migrations apply hendy-server-pro-db --local
npm run dev
```

Local testing also needs a local D1 binding and Queue configuration. Use `wrangler dev` output to confirm bindings are loaded.

## 6. Activate Telegram webhook

After deploy, send an authenticated POST request from a trusted terminal:

```bash
curl -X POST "https://YOUR_WORKER_DOMAIN/set-webhook" \
  -H "Authorization: Bearer YOUR_WEBHOOK_SETUP_KEY"
```

Check webhook state:

```bash
curl "https://YOUR_WORKER_DOMAIN/webhook-info" \
  -H "Authorization: Bearer YOUR_WEBHOOK_SETUP_KEY"
```

The setup key is never returned by the endpoint. Never put it into a public browser page.

## 7. Admin settings and WebSocket

Admin API endpoints require:

```
Authorization: Bearer YOUR_ADMIN_API_TOKEN
```

- `GET /api/admin/settings`
- `PATCH /api/admin/settings` with a JSON object containing `menu_config` and/or `ui_theme`.
- `POST /api/admin/socket-ticket` returns a 60-second signed ticket.
- Connect to `wss://YOUR_WORKER_DOMAIN/ws?ticket=SIGNED_TICKET`.

Do not embed `ADMIN_API_TOKEN` in a public Mini App. A production admin website should authenticate users through Telegram init data validation or an identity provider and call a server-side gateway that keeps this token private.

## 8. GitHub Actions

Configure repository variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_ID`

Configure repository secret:

- `CLOUDFLARE_API_TOKEN` with the minimum Workers Scripts, D1, Durable Objects, Queues and R2 permissions required for deployment.

The CI workflow runs syntax checks, unit tests, config checks and Wrangler dry-run on pull requests and pushes. Production deployment runs only from `main`.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Service banner |
| GET | `/health` | Liveness |
| GET | `/ready` | Binding readiness |
| POST | `/webhook` | Telegram webhook |
| POST | `/set-webhook` | Protected webhook activation |
| GET | `/webhook-info` | Protected webhook inspection |
| GET/PATCH | `/api/admin/settings` | Admin configuration |
| POST | `/api/admin/socket-ticket` | Short-lived WebSocket ticket |
| GET | `/ws?ticket=...` | WebSocket endpoint |

## Important integration boundaries

- A D1 wallet table is provisioned, but V2 does not credit a wallet from an unauthenticated request. Payment provider details and signature format must be supplied before payment automation is enabled.
- The Vietsub queue expects a backend endpoint at `POST /api/v1/vietsub/jobs`. Define its request/response contract and callback authentication before marking a video job completed.
- R2 is provisioned for media assets; signed upload/download policies and retention rules should be defined before accepting user media.
- Social-media engagement providers are not configured. V2 does not claim that a service ran or deduct user balance for a simulated service.

## Operational security checklist

- Rotate the exposed previous Telegram token immediately.
- Keep all credentials in Cloudflare Secrets or GitHub Secrets.
- Enable GitHub secret scanning and push protection.
- Restrict `ADMIN_IDS` to trusted Telegram numeric IDs.
- Use a separate admin identity gateway for browser-based admin interfaces.
- Monitor Worker logs and Telegram `last_error_message`; do not log bot tokens, setup keys, webhook secret headers, or full credentials.
