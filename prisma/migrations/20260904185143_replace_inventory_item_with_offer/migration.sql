-- Replaces EbayInventoryItem with EbayOffer.
--
-- The legacy table mixed listing data with SKU-oriented columns. The new
-- table models listing identity and current report fields directly.
--
-- Inventory is current state, so a report can repopulate it. Before applying
-- this destructive migration to an existing database, back it up and verify
-- that its inventory is recoverable. Historical orders remain preserved.
DROP TABLE "EbayInventoryItem";

CREATE TABLE "EbayOffer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "listingId" TEXT NOT NULL,
    "sku" TEXT,
    "price" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" DATETIME,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "EbayOffer_listingId_key" ON "EbayOffer"("listingId");
CREATE INDEX "EbayOffer_status_idx" ON "EbayOffer"("status");

-- The inventory domain, so the hourly tick can schedule it like orders.
INSERT INTO "EbaySyncSetting" ("domain", "enabled", "frequency", "lookbackDays", "updatedAt")
VALUES ('inventory', true, 'weekly', 1, CURRENT_TIMESTAMP);
