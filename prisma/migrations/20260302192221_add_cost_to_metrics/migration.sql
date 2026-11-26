-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PerformanceMetric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "itemId" TEXT,
    "revenue" REAL NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "averageSalePrice" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "internationalRate" REAL NOT NULL DEFAULT 0,
    "topCategory" TEXT,
    "topBrand" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "ctr" REAL NOT NULL DEFAULT 0,
    "salesConversionRate" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_PerformanceMetric" ("averageSalePrice", "createdAt", "ctr", "date", "id", "impressions", "internationalRate", "itemId", "pageViews", "revenue", "salesConversionRate", "salesCount", "topBrand", "topCategory") SELECT "averageSalePrice", "createdAt", "ctr", "date", "id", "impressions", "internationalRate", "itemId", "pageViews", "revenue", "salesConversionRate", "salesCount", "topBrand", "topCategory" FROM "PerformanceMetric";
DROP TABLE "PerformanceMetric";
ALTER TABLE "new_PerformanceMetric" RENAME TO "PerformanceMetric";
CREATE UNIQUE INDEX "PerformanceMetric_date_itemId_key" ON "PerformanceMetric"("date", "itemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
