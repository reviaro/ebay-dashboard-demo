-- Replaces EbayTrafficReport with the two tables the Analytics API can actually
-- fill, one per dimension it serves.
--
-- EbayTrafficReport is dropped rather than extended: its
-- `@@unique([date, listingId])` could not dedupe the NULL
-- listingId that store-level rows would have carried -- SQLite treats NULLs as
-- distinct, so duplicate store rows would have accumulated silently.
--
-- Two tables rather than one with a `dimension` column for the same reason: a
-- nullable key column cannot be part of a working unique constraint here.
-- Back up any existing database and verify legacy traffic is recoverable
-- before applying this destructive migration.
DROP TABLE "EbayTrafficReport";

CREATE TABLE "EbayTrafficDay" (
    "date" DATETIME NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "impressionsSearch" INTEGER NOT NULL DEFAULT 0,
    "impressionsStore" INTEGER NOT NULL DEFAULT 0,
    "impressionsTotal" INTEGER NOT NULL DEFAULT 0,
    "viewsSearch" INTEGER NOT NULL DEFAULT 0,
    "viewsStore" INTEGER NOT NULL DEFAULT 0,
    "viewsDirect" INTEGER NOT NULL DEFAULT 0,
    "viewsOtherEbay" INTEGER NOT NULL DEFAULT 0,
    "viewsOffEbay" INTEGER NOT NULL DEFAULT 0,
    "viewsTotal" INTEGER NOT NULL DEFAULT 0,
    "transactions" INTEGER NOT NULL DEFAULT 0,
    "reportUpdatedAt" DATETIME,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("date", "marketplaceId")
);

CREATE INDEX "EbayTrafficDay_date_idx" ON "EbayTrafficDay"("date");

CREATE TABLE "EbayTrafficListing" (
    "date" DATETIME NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "title" TEXT,
    "impressionsSearch" INTEGER NOT NULL DEFAULT 0,
    "impressionsStore" INTEGER NOT NULL DEFAULT 0,
    "impressionsTotal" INTEGER NOT NULL DEFAULT 0,
    "viewsSearch" INTEGER NOT NULL DEFAULT 0,
    "viewsStore" INTEGER NOT NULL DEFAULT 0,
    "viewsTotal" INTEGER NOT NULL DEFAULT 0,
    "transactions" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("date", "marketplaceId", "listingId")
);

CREATE INDEX "EbayTrafficListing_listingId_idx" ON "EbayTrafficListing"("listingId");
CREATE INDEX "EbayTrafficListing_date_idx" ON "EbayTrafficListing"("date");

-- The traffic domain, so the hourly tick can schedule it like orders and
-- inventory. Daily, because traffic is daily data and the last few days keep
-- moving until eBay finishes settling them; the 7-day lookback is that
-- settling window, not a catch-up window.
INSERT INTO "EbaySyncSetting" ("domain", "enabled", "frequency", "lookbackDays", "updatedAt")
VALUES ('traffic', true, 'daily', 7, CURRENT_TIMESTAMP);
