-- CreateTable
CREATE TABLE "EbayAdReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportStart" DATETIME NOT NULL,
    "reportEnd" DATETIME NOT NULL,
    "fundingModel" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "campaignStatus" TEXT,
    "listingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "adSpend" REAL NOT NULL DEFAULT 0,
    "attributedSales" REAL NOT NULL DEFAULT 0,
    "attributedUnits" INTEGER NOT NULL DEFAULT 0,
    "cpc" REAL NOT NULL DEFAULT 0,
    "ctr" REAL NOT NULL DEFAULT 0,
    "roas" REAL NOT NULL DEFAULT 0,
    "acos" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EbayAdReport_campaignId_idx" ON "EbayAdReport"("campaignId");

-- CreateIndex
CREATE INDEX "EbayAdReport_listingId_idx" ON "EbayAdReport"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "EbayAdReport_reportStart_reportEnd_fundingModel_campaignId_listingId_key" ON "EbayAdReport"("reportStart", "reportEnd", "fundingModel", "campaignId", "listingId");
