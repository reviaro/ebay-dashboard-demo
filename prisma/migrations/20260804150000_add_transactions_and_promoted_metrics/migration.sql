-- CreateTable
CREATE TABLE "EbayTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transactionKey" TEXT NOT NULL,
    "transactionDate" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "orderNumber" TEXT,
    "itemId" TEXT,
    "transactionId" TEXT,
    "itemTitle" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "itemSubtotal" REAL NOT NULL DEFAULT 0,
    "shipping" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "finalValueFeeFixed" REAL NOT NULL DEFAULT 0,
    "finalValueFeeVariable" REAL NOT NULL DEFAULT 0,
    "regulatoryFee" REAL NOT NULL DEFAULT 0,
    "internationalFee" REAL NOT NULL DEFAULT 0,
    "otherFee" REAL NOT NULL DEFAULT 0,
    "grossAmount" REAL NOT NULL DEFAULT 0,
    "netAmount" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "EbayTransaction_transactionKey_key" ON "EbayTransaction"("transactionKey");
CREATE INDEX "EbayTransaction_transactionDate_idx" ON "EbayTransaction"("transactionDate");
CREATE INDEX "EbayTransaction_orderNumber_idx" ON "EbayTransaction"("orderNumber");
CREATE INDEX "EbayTransaction_itemId_idx" ON "EbayTransaction"("itemId");

-- CreateTable
CREATE TABLE "PromotedListingMetric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportStart" DATETIME NOT NULL,
    "reportEnd" DATETIME NOT NULL,
    "campaignName" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignStatus" TEXT,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" REAL NOT NULL DEFAULT 0,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 0,
    "promotedImpressions" INTEGER NOT NULL DEFAULT 0,
    "promotedClicks" INTEGER NOT NULL DEFAULT 0,
    "promotedSoldQuantity" INTEGER NOT NULL DEFAULT 0,
    "organicSoldQuantity" INTEGER NOT NULL DEFAULT 0,
    "totalSoldQuantity" INTEGER NOT NULL DEFAULT 0,
    "conversionRate" REAL NOT NULL DEFAULT 0,
    "contributionRate" REAL NOT NULL DEFAULT 0,
    "attributedSales" REAL NOT NULL DEFAULT 0,
    "adFees" REAL NOT NULL DEFAULT 0,
    "roas" REAL NOT NULL DEFAULT 0,
    "organicClicks" INTEGER NOT NULL DEFAULT 0,
    "organicImpressions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PromotedListingMetric_reportStart_reportEnd_campaignId_itemId_key" ON "PromotedListingMetric"("reportStart", "reportEnd", "campaignId", "itemId");
CREATE INDEX "PromotedListingMetric_campaignId_idx" ON "PromotedListingMetric"("campaignId");
CREATE INDEX "PromotedListingMetric_itemId_idx" ON "PromotedListingMetric"("itemId");
