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
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "watchers" INTEGER NOT NULL DEFAULT 0,
    "pulledAt" DATETIME,
    "soldAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Inventory" ("brand", "condition", "cost", "createdAt", "id", "itemId", "location", "partNumber", "price", "pulledAt", "sku", "soldAt", "title", "views", "watchers") SELECT "brand", "condition", "cost", "createdAt", "id", "itemId", "location", "partNumber", "price", "pulledAt", "sku", "soldAt", "title", "views", "watchers" FROM "Inventory";
DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE UNIQUE INDEX "Inventory_itemId_key" ON "Inventory"("itemId");
CREATE UNIQUE INDEX "Inventory_sku_key" ON "Inventory"("sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
