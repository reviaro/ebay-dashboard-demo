-- Baseline: create the tables that were introduced with `prisma db push`.
--
-- `db push` applies a schema change directly and writes no migration file, so
-- a baseline is needed to replay those tables onto an empty database before
-- later migrations reference them.
--
-- This migration is dated before 20260804213000 so that InventoryExpense and
-- EbayFee exist by the time that migration ALTERs them. For that reason both
-- are created here WITHOUT the `importKey` column and its unique index --
-- harden_import_keys adds those.
--
-- This DDL defines the baseline schema for later migrations.
--
-- On the existing database this migration is recorded with
-- `prisma migrate resolve --applied`; it is never executed there. IF NOT EXISTS
-- guards make it safe if it ever does run against a partially-populated schema.

-- >>> EbayFee
CREATE TABLE IF NOT EXISTS "EbayFee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "month" TEXT NOT NULL,
    "feeType" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- >>> EbayInventoryItem
CREATE TABLE IF NOT EXISTS "EbayInventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "title" TEXT,
    "condition" TEXT,
    "conditionDescription" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "price" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "categoryId" TEXT,
    "categoryName" TEXT,
    "imageUrls" TEXT,
    "aspects" TEXT,
    "packageType" TEXT,
    "weight" REAL,
    "listingIds" TEXT,
    "listingStatus" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "EbayInventoryItem_sku_key" ON "EbayInventoryItem"("sku");

-- >>> EbayOrder
CREATE TABLE IF NOT EXISTS "EbayOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legacyOrderId" TEXT,
    "creationDate" DATETIME NOT NULL,
    "lastModifiedDate" DATETIME NOT NULL,
    "orderFulfillmentStatus" TEXT NOT NULL,
    "orderPaymentStatus" TEXT NOT NULL,
    "sellerId" TEXT,
    "buyerUsername" TEXT,
    "buyerEmail" TEXT,
    "pricingSummary" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ebayFees" REAL NOT NULL DEFAULT 0,
    "finalValueFee" REAL NOT NULL DEFAULT 0,
    "internationalFee" REAL NOT NULL DEFAULT 0,
    "adFee" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "netProceeds" REAL NOT NULL DEFAULT 0,
    "lineItems" TEXT NOT NULL,
    "fulfillmentHrefs" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- >>> EbayPriceComparison
CREATE TABLE IF NOT EXISTS "EbayPriceComparison" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sku" TEXT NOT NULL,
    "title" TEXT,
    "yourPrice" REAL NOT NULL,
    "minPrice" REAL,
    "maxPrice" REAL,
    "avgPrice" REAL,
    "medianPrice" REAL,
    "competitorCount" INTEGER NOT NULL DEFAULT 0,
    "recommendation" TEXT,
    "priceDiff" REAL,
    "sampleListings" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EbayPriceComparison_sku_key" ON "EbayPriceComparison"("sku");

-- >>> EbaySyncConfig
CREATE TABLE IF NOT EXISTS "EbaySyncConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "EbaySyncConfig_key_key" ON "EbaySyncConfig"("key");

-- >>> EbaySyncLog
CREATE TABLE IF NOT EXISTS "EbaySyncLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- >>> EbayTrafficReport
CREATE TABLE IF NOT EXISTS "EbayTrafficReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "listingId" TEXT,
    "title" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "ctr" REAL NOT NULL DEFAULT 0,
    "salesConversionRate" REAL NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "salesAmount" REAL NOT NULL DEFAULT 0,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EbayTrafficReport_date_listingId_key" ON "EbayTrafficReport"("date", "listingId");

-- >>> GeneralExpense
CREATE TABLE IF NOT EXISTS "GeneralExpense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- >>> InventoryExpense
CREATE TABLE IF NOT EXISTS "InventoryExpense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "vendor" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- >>> ListingNote
CREATE TABLE IF NOT EXISTS "ListingNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "listingId" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ListingNote_listingId_idx" ON "ListingNote"("listingId");


-- UploadRecord itself was created by 20260303203141_add_upload_record, but its
-- contentHash column and unique index were added later with `db push` and so
-- lacked a migration. Added here to close that gap.
ALTER TABLE "UploadRecord" ADD COLUMN "contentHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "UploadRecord_contentHash_key" ON "UploadRecord"("contentHash");
