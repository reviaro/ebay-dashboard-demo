-- Make PerformanceMetric.itemId NOT NULL.
--
-- SQLite's unique index treats NULLs as distinct, so @@unique([date, itemId])
-- could not dedupe store-level rows: two rows with the same date and a NULL
-- itemId were both accepted. The only write path
-- (src/app/api/upload/route.ts) already skips rows without an itemId, so this
-- makes an existing application guard structural. Verified 0 NULL rows before
-- applying, so no data is dropped by the WHERE clause below.
--
-- Store-level (non-per-listing) traffic is deliberately NOT modelled as a NULL
-- itemId here; it belongs in the Phase 5 traffic schema with an explicit
-- dimension column.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PerformanceMetric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "itemId" TEXT NOT NULL,
    "revenue" REAL NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "averageSalePrice" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "internationalRate" REAL NOT NULL DEFAULT 0,
    "canadaSalesCount" INTEGER NOT NULL DEFAULT 0,
    "ukSalesCount" INTEGER NOT NULL DEFAULT 0,
    "topCategory" TEXT,
    "topBrand" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "ctr" REAL NOT NULL DEFAULT 0,
    "salesConversionRate" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_PerformanceMetric" (
    "id", "date", "itemId", "revenue", "salesCount", "averageSalePrice", "cost",
    "internationalRate", "canadaSalesCount", "ukSalesCount", "topCategory",
    "topBrand", "impressions", "pageViews", "ctr", "salesConversionRate", "createdAt"
)
SELECT
    "id", "date", "itemId", "revenue", "salesCount", "averageSalePrice", "cost",
    "internationalRate", "canadaSalesCount", "ukSalesCount", "topCategory",
    "topBrand", "impressions", "pageViews", "ctr", "salesConversionRate", "createdAt"
FROM "PerformanceMetric"
WHERE "itemId" IS NOT NULL;

DROP TABLE "PerformanceMetric";
ALTER TABLE "new_PerformanceMetric" RENAME TO "PerformanceMetric";
CREATE UNIQUE INDEX "PerformanceMetric_date_itemId_key" ON "PerformanceMetric"("date", "itemId");

PRAGMA foreign_keys=ON;
