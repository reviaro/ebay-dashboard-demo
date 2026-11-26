PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Sale" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordNumber" INTEGER,
    "orderNumber" TEXT,
    "sourceKey" TEXT,
    "saleDate" DATETIME NOT NULL,
    "itemTitle" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "itemNumber" TEXT,
    "soldFor" REAL NOT NULL DEFAULT 0,
    "shipping" REAL NOT NULL DEFAULT 0,
    "eBayTax" REAL NOT NULL DEFAULT 0,
    "totalPrice" REAL NOT NULL DEFAULT 0,
    "shipToState" TEXT,
    "shipToCountry" TEXT,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Sale" ("id","recordNumber","orderNumber","sourceKey","saleDate","itemTitle","brand","itemNumber","soldFor","shipping","eBayTax","totalPrice","shipToState","shipToCountry","promoted","quantity","createdAt")
SELECT "id","recordNumber","orderNumber",COALESCE('legacy-record-' || "recordNumber", 'legacy-id-' || "id"),"saleDate","itemTitle","brand","itemNumber","soldFor","shipping","eBayTax","totalPrice","shipToState","shipToCountry","promoted","quantity","createdAt" FROM "Sale";
DROP TABLE "Sale";
ALTER TABLE "new_Sale" RENAME TO "Sale";
CREATE UNIQUE INDEX "Sale_sourceKey_key" ON "Sale"("sourceKey");
CREATE INDEX "Sale_orderNumber_idx" ON "Sale"("orderNumber");

ALTER TABLE "InventoryExpense" ADD COLUMN "importKey" TEXT;
CREATE UNIQUE INDEX "InventoryExpense_importKey_key" ON "InventoryExpense"("importKey");
ALTER TABLE "EbayFee" ADD COLUMN "importKey" TEXT;
CREATE UNIQUE INDEX "EbayFee_importKey_key" ON "EbayFee"("importKey");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
