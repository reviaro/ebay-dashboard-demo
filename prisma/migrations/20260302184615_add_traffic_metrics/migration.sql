-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Inventory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" TEXT,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "partNumber" TEXT,
    "condition" TEXT,
    "price" REAL NOT NULL,
    "cost" REAL,
    "location" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "watchers" INTEGER NOT NULL DEFAULT 0,
    "pulledAt" DATETIME,
    "soldAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Inventory" ("brand", "condition", "cost", "createdAt", "id", "location", "partNumber", "price", "pulledAt", "sku", "soldAt", "title") SELECT "brand", "condition", "cost", "createdAt", "id", "location", "partNumber", "price", "pulledAt", "sku", "soldAt", "title" FROM "Inventory";
DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE UNIQUE INDEX "Inventory_itemId_key" ON "Inventory"("itemId");
CREATE UNIQUE INDEX "Inventory_sku_key" ON "Inventory"("sku");
CREATE TABLE "new_PerformanceMetric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "revenue" REAL NOT NULL,
    "salesCount" INTEGER NOT NULL,
    "averageSalePrice" REAL NOT NULL,
    "internationalRate" REAL NOT NULL,
    "topCategory" TEXT,
    "topBrand" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "ctr" REAL NOT NULL DEFAULT 0,
    "salesConversionRate" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_PerformanceMetric" ("averageSalePrice", "createdAt", "date", "id", "internationalRate", "revenue", "salesCount", "topBrand", "topCategory") SELECT "averageSalePrice", "createdAt", "date", "id", "internationalRate", "revenue", "salesCount", "topBrand", "topCategory" FROM "PerformanceMetric";
DROP TABLE "PerformanceMetric";
ALTER TABLE "new_PerformanceMetric" RENAME TO "PerformanceMetric";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
