# Northstar Sample Parts data

Northstar Sample Parts is a fictional used auto parts store. The fixture uses recognizable vehicle makes and models. Orders, listing offers, campaigns, finance transactions, and payouts use synthetic identifiers. Order identity fields are empty. The snapshot contains one store, `northstar`, with writes disabled, and no user or eBay account rows.

The reporting window covers **October 1, 2025 through September 30, 2026**, inclusive. Relative date filters use September 30, 2026 as the reference date.

## Reproduce the snapshot

Use Node.js 24 and the checked-in lockfile.

```sh
npm ci
npx prisma generate
npm run seed:demo
npm run demo:answers
TZ=UTC npm test -- src/lib/demo/data.test.ts src/lib/demo/seed-safety.test.ts src/lib/demo/answers.test.ts
```

The seed applies the checked-in migration chain with `prisma migrate deploy` to a fresh staging database. It inserts deterministic fixtures in one transaction, verifies the persisted rows and financial totals, and installs `prisma/demo.db` with mode `0444`. All business rows in the fixture belong to `northstar`. The seed normalizes migration record IDs and timestamps and compacts the database. Migration names and SQL checksums are preserved.

Both the seed and answer scripts set `DATABASE_URL=file:./demo.db`. The seed supplies Prisma with the explicit staging path. It checks the final destination before building and again before replacing it. An existing database must match its synthetic manifest before the seed will replace it. Stop the demo server before reseeding.

The generator uses a fixed pseudo-random sequence, explicit identifiers, and fixed timestamps. Repeated runs with the same migration chain and toolchain produce identical SQLite bytes. Two consecutive seeds of this snapshot produced the following SHA-256, recorded in the accompanying `prisma/demo-manifest.json`.

```text
032b75ba4295437829c6f3643dba64406aebea2d8bf05667fa452819d3eead76
```

The generated manifest declares `schemaVersion: 1`, `synthetic: true`, the fixed `asOf` date, and `sha256`. Startup verifies these values, the file type and permissions, and the absence of SQLite sidecars. Keep the database and manifest together as local generated files.

## Dataset at a glance

| Dataset | Count or range |
| --- | --- |
| Inventory records and corresponding offers | 60 each · 56 active, 2 sold, 2 ended |
| Inventory prices | $23.95–$589.95 · 44 under $150 |
| Listing composer drafts | 3 · attributed to `demo:viewer` |
| Orders | 1,020 one-item orders with matching sale and finance rows |
| Full item-and-shipping refunds | 40 · 3.92% of orders |
| Traffic | 365 store-day totals and 21,900 listing-day rows |
| Advertising | 3 campaigns and 720 monthly listing-report rows |
| Payouts | 12 month-end settlements |
| Expenses | 12 inventory purchase rows and 36 operating expense rows |
| Tasks and listing notes | 6 of each |
| Import history and sync state | 5 sample import records, 6 disabled schedules, and 1 seed log |

The monthly order count rises from 58 in October to 114 in September. Six low-conversion listings receive views throughout the reporting window without any orders. The model includes a lower-performing discovery campaign and a change in sale fees in April. These assumptions belong to the fictional dataset.

## Full-year reconciliation

Amounts are generated in integer cents. The verifier opens the seeded SQLite database read-only and checks each order against its sale and finance rows. The sum of daily listing traffic matches the store-level views, impressions, and order counts. Advertising report spend matches the finance ledger, and each payout agrees with its underlying transactions. The operating transaction history mirrors the same settlement total.

| Financial activity | USD |
| --- | ---: |
| Gross item receipts and collected shipping | 148,468.87 |
| Sale fees | (20,286.10) |
| Refunds | (5,959.00) |
| Advertising | (5,045.23) |
| Shipping labels | (8,699.00) |
| Other platform fees | (263.40) |
| **Settled payouts** | **108,216.14** |

Payouts model same-month settlement. Refunds retain the original selling fees and acquisition cost. Marketplace-remitted taxes appear in order totals and are excluded from seller gross receipts. Inventory purchases and operating expenses are separate from platform settlement.

## Cached answers

`npm run demo:answers` rebuilds the five answers in `src/lib/demo/answers.json` from the verified SQLite snapshot. Each entry records its source tables, date range, and calculation.

- **Brand contribution** ranks brands by third-quarter revenue after sale fees, refunds, acquisition cost, postage, and listing-level ad spend. Shared overhead and taxes are outside that calculation.
- **Ad spend** ranks campaigns by attributed sales divided by spend and identifies listings that incurred spend without attributed orders.
- **Views without sales** sums September views on listings with stock and zero orders.
- **Relist or reprice** uses that same September selection to illustrate a 10% price test rounded to cents.
- **Fee trend** compares the October 2025 and September 2026 sale fees as a share of gross receipts.

[Run the demo](demo-setup.md) · [Safety controls and route table](demo-audit.md)
