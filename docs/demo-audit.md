# Demo safety audit

The read-only demo is enabled by the exact server value `DEMO_MODE=1`. The request proxy applies the API allowlist before authentication. For permitted store requests, `withStore` independently checks the route and method in `authorizeStore` and accepts only the view permission. The server supplies store ID `northstar`, actor ID `demo:viewer`, role `viewer`, and marketplace `EBAY_US`. Standalone handlers check the demo route policy directly, including the Pages Router login handler and the eBay callback.

## API route policy

The table covers **74 exported route and method combinations across 50 route files**. There are **21 reads, one cached chat handler, and 52 denials**. An implicit `HEAD` follows a read-classified `GET`. Unknown paths and other unlisted methods, including `OPTIONS`, are denied. The proxy returns 404 for denied reads and 403 for denied writes. The route coverage test checks both routers for missing and stale decisions.

| Route | Read | Cached chat | Denied |
| --- | --- | --- | --- |
| `/api/advertising` | GET | — | — |
| `/api/agent/inventory` | — | — | GET |
| `/api/agent/metrics` | — | — | GET |
| `/api/agent/orders` | — | — | GET |
| `/api/agent/profitability` | — | — | GET |
| `/api/agent/sourcing/search` | — | — | GET |
| `/api/agent/tasks` | — | — | GET, POST, PUT, DELETE |
| `/api/agent/traffic` | — | — | GET |
| `/api/auth/accept-invitation` | — | — | POST |
| `/api/auth/login` | — | — | POST |
| `/api/auth/logout` | — | — | POST |
| `/api/auth/session` | GET | — | — |
| `/api/chat` | — | POST | GET |
| `/api/ebay/auth/callback` | — | — | GET, POST |
| `/api/ebay/disconnect` | — | — | POST |
| `/api/ebay/oauth/callback` | — | — | GET, POST |
| `/api/ebay/oauth/start` | — | — | POST |
| `/api/ebay/status` | GET | — | — |
| `/api/ebay/sync/advertising` | — | — | POST |
| `/api/ebay/sync/finances` | — | — | POST |
| `/api/ebay/sync/inventory` | — | — | POST |
| `/api/ebay/sync/logs` | GET | — | — |
| `/api/ebay/sync/orders` | — | — | POST |
| `/api/ebay/sync/payouts` | — | — | POST |
| `/api/ebay/sync/settings` | GET | — | PUT |
| `/api/ebay/sync/status` | GET | — | — |
| `/api/ebay/sync/traffic` | — | — | POST |
| `/api/expenses` | GET | — | — |
| `/api/general-expenses` | GET | — | POST, DELETE |
| `/api/inventory` | GET | — | — |
| `/api/listings` | GET | — | POST |
| `/api/listings/assets` | — | — | GET, POST |
| `/api/listings/metadata` | GET | — | — |
| `/api/metrics` | GET | — | DELETE |
| `/api/orders` | GET | — | — |
| `/api/profitability` | GET | — | — |
| `/api/reports` | GET | — | — |
| `/api/reset` | — | — | DELETE |
| `/api/sourcing/search` | — | — | GET |
| `/api/stores` | GET | — | POST, PATCH |
| `/api/stores/agent-keys` | — | — | GET, POST, DELETE |
| `/api/stores/members` | — | — | GET, POST, PATCH |
| `/api/tasks` | GET | — | POST, PUT, DELETE |
| `/api/tasks/suggest` | GET | — | — |
| `/api/traffic` | GET | — | — |
| `/api/traffic/[listingId]` | GET | — | — |
| `/api/traffic/notes` | GET | — | POST |
| `/api/upload` | — | — | POST |
| `/api/uploads` | — | — | GET, DELETE |
| `/api/users` | — | — | GET, PATCH |

The chat endpoint serves the five cached answers by question ID, exact question text, or the last chat message. It returns a fixed response for other text, rejects malformed JSON and bodies over 16 KiB, and leaves the conversation in the browser. Sourcing searches filter a local browser fixture. The listing composer opens a sample draft by default and disables saving, validation, publishing, and photo uploads. The listing metadata API returns synthetic policies, categories, and aspects.

## Database and integrations

Startup checks the local SQLite file and its manifest, checks the SHA-256 and file permissions, rejects symlinks, extra hard links and SQLite sidecars, and refuses UID 0. Only an unset `DATABASE_URL` or the exact value `file:./demo.db` is accepted. Both the administrative and store-scoped Prisma clients allow model reads only, including within interactive transactions. This blocks raw SQL and model writes. The snapshot also has read-only file permissions.

`assertLiveIntegrationAllowed()` blocks the eBay reporting client, token exchange, seller identity lookup, Trading operations, listing asset operations, taxonomy lookups, AI reply generation for Gemini, OpenAI and Anthropic, and yard scrapers. The same guard runs before these command-line entry points do work.

- `scripts/sync-due.ts`
- `scripts/listing-worker.ts`
- `scripts/bootstrap-owner.ts`
- `scripts/reset-user.ts`
- `scripts/backfill-brands.ts`
- `scripts/seed-advertising-setting.ts`

## Response headers

On demo requests it allows and on the login redirect, the proxy adds these headers.

| Header | Value |
| --- | --- |
| `X-Demo-Mode` | `read-only` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |

The Content Security Policy limits network connections and fonts to the same origin. Images can also use `data:` and `blob:` URLs. Inline scripts and styles are permitted. The policy disables frames, frame ancestors, objects, and form submissions, and restricts base URLs to the same origin.

```text
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

## Known dependency advisories

`npm audit` reports **four high findings** and zero critical or moderate findings for the lockfile. These are four package entries for two advisories in the Prisma CLI's configuration loader. `effect` has a regular-expression denial of service in `Schema.TemplateLiteral`. `deepmerge-ts` can exhaust the stack when merging recursive object graphs. Both enter through `@prisma/config`, which also accounts for the Prisma CLI's own audit entry. [Effect advisory](https://github.com/advisories/GHSA-7589-6fvf-x4pw) · [DeepmergeTS advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)

The affected loader is build-time tooling that reads this checkout's configuration. The demo request path uses Prisma Client, and all reported findings are in the CLI's config loader. `npm audit --omit=dev` still lists the same four entries because `@prisma/client` declares the Prisma CLI as an optional peer. For the locked dependency graph, npm's only reported remediation is a Prisma 7 major upgrade. The demo uses Prisma 6.

## Reproduce the checks

```sh
TZ=UTC npm test
npm run typecheck
npm run lint
npm audit
npm audit --omit=dev
```

With the built demo running, `npm run test:demo:http` checks all 16 pages and all seven tested HTTP methods for every classified route. It also checks reconciliation, chat input, and the main SQLite file and sidecars before and after requests. Separately, `npm run test:auth:http` verifies the sign-in boundary when demo mode is off and tests startup refusals. See [the setup guide](demo-setup.md) to start the demo.
