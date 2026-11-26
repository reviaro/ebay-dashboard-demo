# Run the Northstar demo

Northstar Sample Parts is a fictional used auto parts store. The demo covers **October 1, 2025 through September 30, 2026** and keeps the reporting date fixed at September 30. It needs no eBay account, API keys, or sign-in.

Start on the dashboard to see the monthly trends, compare orders and inventory, or open a sample listing draft. The composer displays the saved part details and disables saving, validation, publishing, and photo upload. On the dashboard, **Ask Agent** opens five questions with cached answers. The sourcing page uses a local map and sample yard inventory.

## Deploy

Use Node.js 24 under a non-root account. UID 0 is refused at startup. Run the following from the checkout root. Generate Prisma Client explicitly because npm may skip dependency install scripts.

```sh
npm ci
npx prisma generate
npm run seed:demo
npm run demo:build
npm run demo:start
```

Open `http://127.0.0.1:3941`. The last command starts a foreground server and binds to loopback by default. For a persistent deployment, stop that foreground process and start the included systemd user service. Its `WorkingDirectory` is relative to the service account's home directory through `%h`, and it runs `npm run demo:start`. Set the working directory to your checkout, use the absolute path to npm in `ExecStart`, and make Node.js 24 available on the service's `PATH`. [Systemd user service](../deploy/demo/ebay-dashboard-demo.service)

```sh
install -D -m 644 deploy/demo/ebay-dashboard-demo.service "$HOME/.config/systemd/user/ebay-dashboard-demo.service"
systemctl --user daemon-reload
systemctl --user enable --now ebay-dashboard-demo.service
```

Put an HTTPS reverse proxy in front of the service. Keep the loopback bind when the reverse proxy runs on the same machine. Set `DEMO_HOST` in the user service environment only when the proxy runs on another machine. Bind to an interface the proxy can reach and restrict access to port 3941 to the proxy. Always run the demo service as a non-root user.

### Update an existing deployment

```sh
git pull --ff-only
npm ci
npx prisma generate
npm run demo:build
systemctl --user restart ebay-dashboard-demo.service
```

The update keeps the existing snapshot and manifest. Reseed only when the data generator changes. Stop the service before reseeding, then rebuild and start it again. To regenerate the five cached answers from the verified snapshot, run `npm run demo:answers` before building.

## How demo mode is selected

Only the exact server environment value `DEMO_MODE=1` enables demo mode. The demo build and start scripts set it automatically. A query parameter, cookie, or browser flag has no effect. The server scopes permitted store requests to `northstar` as a viewer and validates the synthetic database at startup.

The seed, answer generation, build, start, and demo HTTP smoke scripts pin `DATABASE_URL=file:./demo.db`. The runtime accepts that exact value or an unset variable and resolves the snapshot to `prisma/demo.db`. Fira Sans and Fira Code are bundled with the app. The demo map uses local artwork and marker icons.

## Verify the demo

```sh
TZ=UTC npm test
npm run typecheck
npm run lint

# With the demo running on loopback
npm run test:demo:http

# Starts and stops a separate loopback server from the same build
npm run test:auth:http
```

The demo smoke checks every page and classified API, cached chat, the local font assets, and the database hash. The authentication smoke checks the default sign-in boundary and confirms that the server exits on a wrong database URL or simulated UID 0.

[Data and reconciliation](demo-data.md) · [Safety controls and route table](demo-audit.md)
