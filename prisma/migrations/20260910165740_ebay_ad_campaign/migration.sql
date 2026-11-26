-- CreateTable
CREATE TABLE "EbayAdCampaign" (
    "campaignId" TEXT NOT NULL PRIMARY KEY,
    "campaignName" TEXT NOT NULL,
    "fundingModel" TEXT NOT NULL,
    "campaignStatus" TEXT NOT NULL,
    "channels" TEXT,
    "targetingType" TEXT,
    "dailyBudget" REAL,
    "budgetCurrency" TEXT,
    "bidPercentage" REAL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "lastSeenAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EbayAdCampaign_campaignStatus_idx" ON "EbayAdCampaign"("campaignStatus");
