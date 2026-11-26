-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL DEFAULT 'EBAY_US',
    "writeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "descriptionTemplate" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoreMembership" (
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    PRIMARY KEY ("storeId", "userId"),
    CONSTRAINT "StoreMembership_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoreMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserInvitation" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "canEditTasks" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentKey_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "listingId" TEXT,
    "remoteSnapshot" TEXT,
    "validation" TEXT,
    "publishedPayload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ListingDraft_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "ebayUrl" TEXT,
    "ebayExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListingAsset_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "listingId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListingOperation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ListingOperation_storeId_draftId_fkey" FOREIGN KEY ("storeId", "draftId") REFERENCES "ListingDraft" ("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Existing business records belong to the original store. Do not add a
-- column default: every future write must explicitly identify its store.
INSERT INTO "Store" ("id", "name", "updatedAt") VALUES ('legacy', 'Store 1', CURRENT_TIMESTAMP);
-- Pending authorizations predate user/session binding and must be restarted.
DELETE FROM "EbayOAuthState";
-- Replace the historical marketplace placeholder with the stable connection ID.
UPDATE "EbayFinanceTransaction" SET "accountId" = COALESCE((SELECT "id" FROM "EbayAccount" WHERE "marketplaceId" = "EbayFinanceTransaction"."accountId" ORDER BY CASE "environment" WHEN 'production' THEN 0 ELSE 1 END LIMIT 1), "accountId");
UPDATE "EbayPayout" SET "accountId" = COALESCE((SELECT "id" FROM "EbayAccount" WHERE "marketplaceId" = "EbayPayout"."accountId" ORDER BY CASE "environment" WHEN 'production' THEN 0 ELSE 1 END LIMIT 1), "accountId");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PerformanceMetric" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "itemId" TEXT NOT NULL,
    "revenue" REAL NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "averageSalePrice" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "internationalRate" REAL NOT NULL DEFAULT 0,
    "canadaSalesCount" INTEGER NOT NULL DEFAULT 0,
    "ukSalesCount" INTEGER NOT NULL DEFAULT 0,
    "topCategory" TEXT,
    "topBrand" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "ctr" REAL NOT NULL DEFAULT 0,
    "salesConversionRate" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceMetric_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PerformanceMetric" ("storeId", "averageSalePrice", "canadaSalesCount", "cost", "createdAt", "ctr", "date", "id", "impressions", "internationalRate", "itemId", "pageViews", "revenue", "salesConversionRate", "salesCount", "topBrand", "topCategory", "ukSalesCount") SELECT 'legacy', "averageSalePrice", "canadaSalesCount", "cost", "createdAt", "ctr", "date", "id", "impressions", "internationalRate", "itemId", "pageViews", "revenue", "salesConversionRate", "salesCount", "topBrand", "topCategory", "ukSalesCount" FROM "PerformanceMetric";
DROP TABLE "PerformanceMetric";
ALTER TABLE "new_PerformanceMetric" RENAME TO "PerformanceMetric";
CREATE INDEX "PerformanceMetric_storeId_idx" ON "PerformanceMetric"("storeId");
CREATE UNIQUE INDEX "PerformanceMetric_storeId_date_itemId_key" ON "PerformanceMetric"("storeId", "date", "itemId");
CREATE TABLE "new_Task" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "report" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueDate" DATETIME,
    "phase" INTEGER DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("storeId", "createdAt", "description", "dueDate", "id", "phase", "priority", "report", "status", "title", "updatedAt") SELECT 'legacy', "createdAt", "description", "dueDate", "id", "phase", "priority", "report", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_storeId_idx" ON "Task"("storeId");
CREATE TABLE "new_ChatMessage" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ChatMessage" ("storeId", "content", "createdAt", "id", "role") SELECT 'legacy', "content", "createdAt", "id", "role" FROM "ChatMessage";
DROP TABLE "ChatMessage";
ALTER TABLE "new_ChatMessage" RENAME TO "ChatMessage";
CREATE INDEX "ChatMessage_storeId_idx" ON "ChatMessage"("storeId");
CREATE TABLE "new_UploadRecord" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "filename" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT,
    CONSTRAINT "UploadRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_UploadRecord" ("storeId", "contentHash", "createdAt", "filename", "id", "rowCount", "type") SELECT 'legacy', "contentHash", "createdAt", "filename", "id", "rowCount", "type" FROM "UploadRecord";
DROP TABLE "UploadRecord";
ALTER TABLE "new_UploadRecord" RENAME TO "UploadRecord";
CREATE INDEX "UploadRecord_storeId_idx" ON "UploadRecord"("storeId");
CREATE UNIQUE INDEX "UploadRecord_storeId_contentHash_key" ON "UploadRecord"("storeId", "contentHash");
CREATE TABLE "new_EbayTransaction" (
    "storeId" TEXT NOT NULL,
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
    "veryHighInadFee" REAL NOT NULL DEFAULT 0,
    "belowStandardFee" REAL NOT NULL DEFAULT 0,
    "internationalFee" REAL NOT NULL DEFAULT 0,
    "otherFee" REAL NOT NULL DEFAULT 0,
    "grossAmount" REAL NOT NULL DEFAULT 0,
    "netAmount" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EbayTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayTransaction" ("storeId", "belowStandardFee", "createdAt", "currency", "description", "finalValueFeeFixed", "finalValueFeeVariable", "grossAmount", "id", "internationalFee", "itemId", "itemSubtotal", "itemTitle", "netAmount", "orderNumber", "otherFee", "quantity", "regulatoryFee", "shipping", "tax", "transactionDate", "transactionId", "transactionKey", "type", "veryHighInadFee") SELECT 'legacy', "belowStandardFee", "createdAt", "currency", "description", "finalValueFeeFixed", "finalValueFeeVariable", "grossAmount", "id", "internationalFee", "itemId", "itemSubtotal", "itemTitle", "netAmount", "orderNumber", "otherFee", "quantity", "regulatoryFee", "shipping", "tax", "transactionDate", "transactionId", "transactionKey", "type", "veryHighInadFee" FROM "EbayTransaction";
DROP TABLE "EbayTransaction";
ALTER TABLE "new_EbayTransaction" RENAME TO "EbayTransaction";
CREATE INDEX "EbayTransaction_storeId_transactionDate_idx" ON "EbayTransaction"("storeId", "transactionDate");
CREATE INDEX "EbayTransaction_storeId_orderNumber_idx" ON "EbayTransaction"("storeId", "orderNumber");
CREATE INDEX "EbayTransaction_storeId_itemId_idx" ON "EbayTransaction"("storeId", "itemId");
CREATE INDEX "EbayTransaction_storeId_idx" ON "EbayTransaction"("storeId");
CREATE UNIQUE INDEX "EbayTransaction_storeId_transactionKey_key" ON "EbayTransaction"("storeId", "transactionKey");
CREATE TABLE "new_PromotedListingMetric" (
    "storeId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotedListingMetric_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PromotedListingMetric" ("storeId", "adFees", "attributedSales", "campaignId", "campaignName", "campaignStatus", "contributionRate", "conversionRate", "createdAt", "id", "itemId", "organicClicks", "organicImpressions", "organicSoldQuantity", "price", "promotedClicks", "promotedImpressions", "promotedSoldQuantity", "quantityAvailable", "reportEnd", "reportStart", "roas", "title", "totalSoldQuantity") SELECT 'legacy', "adFees", "attributedSales", "campaignId", "campaignName", "campaignStatus", "contributionRate", "conversionRate", "createdAt", "id", "itemId", "organicClicks", "organicImpressions", "organicSoldQuantity", "price", "promotedClicks", "promotedImpressions", "promotedSoldQuantity", "quantityAvailable", "reportEnd", "reportStart", "roas", "title", "totalSoldQuantity" FROM "PromotedListingMetric";
DROP TABLE "PromotedListingMetric";
ALTER TABLE "new_PromotedListingMetric" RENAME TO "PromotedListingMetric";
CREATE INDEX "PromotedListingMetric_storeId_campaignId_idx" ON "PromotedListingMetric"("storeId", "campaignId");
CREATE INDEX "PromotedListingMetric_storeId_itemId_idx" ON "PromotedListingMetric"("storeId", "itemId");
CREATE INDEX "PromotedListingMetric_storeId_idx" ON "PromotedListingMetric"("storeId");
CREATE UNIQUE INDEX "PromotedListingMetric_storeId_reportStart_reportEnd_campaignId_itemId_key" ON "PromotedListingMetric"("storeId", "reportStart", "reportEnd", "campaignId", "itemId");
CREATE TABLE "new_EbayAdReport" (
    "storeId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EbayAdReport_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayAdReport" ("storeId", "acos", "adSpend", "attributedSales", "attributedUnits", "campaignId", "campaignName", "campaignStatus", "clicks", "cpc", "createdAt", "ctr", "fundingModel", "id", "impressions", "listingId", "reportEnd", "reportStart", "roas", "title") SELECT 'legacy', "acos", "adSpend", "attributedSales", "attributedUnits", "campaignId", "campaignName", "campaignStatus", "clicks", "cpc", "createdAt", "ctr", "fundingModel", "id", "impressions", "listingId", "reportEnd", "reportStart", "roas", "title" FROM "EbayAdReport";
DROP TABLE "EbayAdReport";
ALTER TABLE "new_EbayAdReport" RENAME TO "EbayAdReport";
CREATE INDEX "EbayAdReport_storeId_campaignId_idx" ON "EbayAdReport"("storeId", "campaignId");
CREATE INDEX "EbayAdReport_storeId_listingId_idx" ON "EbayAdReport"("storeId", "listingId");
CREATE INDEX "EbayAdReport_storeId_idx" ON "EbayAdReport"("storeId");
CREATE UNIQUE INDEX "EbayAdReport_storeId_reportStart_reportEnd_fundingModel_campaignId_listingId_key" ON "EbayAdReport"("storeId", "reportStart", "reportEnd", "fundingModel", "campaignId", "listingId");
CREATE TABLE "new_EbayAdCampaign" (
    "storeId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("storeId", "campaignId"),
    CONSTRAINT "EbayAdCampaign_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayAdCampaign" ("storeId", "bidPercentage", "budgetCurrency", "campaignId", "campaignName", "campaignStatus", "channels", "createdAt", "dailyBudget", "endDate", "fundingModel", "lastSeenAt", "startDate", "targetingType") SELECT 'legacy', "bidPercentage", "budgetCurrency", "campaignId", "campaignName", "campaignStatus", "channels", "createdAt", "dailyBudget", "endDate", "fundingModel", "lastSeenAt", "startDate", "targetingType" FROM "EbayAdCampaign";
DROP TABLE "EbayAdCampaign";
ALTER TABLE "new_EbayAdCampaign" RENAME TO "EbayAdCampaign";
CREATE INDEX "EbayAdCampaign_storeId_campaignStatus_idx" ON "EbayAdCampaign"("storeId", "campaignStatus");
CREATE INDEX "EbayAdCampaign_storeId_idx" ON "EbayAdCampaign"("storeId");
CREATE TABLE "new_Sale" (
    "storeId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Sale" ("storeId", "brand", "createdAt", "eBayTax", "id", "itemNumber", "itemTitle", "orderNumber", "promoted", "quantity", "recordNumber", "saleDate", "shipToCountry", "shipToState", "shipping", "soldFor", "sourceKey", "totalPrice") SELECT 'legacy', "brand", "createdAt", "eBayTax", "id", "itemNumber", "itemTitle", "orderNumber", "promoted", "quantity", "recordNumber", "saleDate", "shipToCountry", "shipToState", "shipping", "soldFor", "sourceKey", "totalPrice" FROM "Sale";
DROP TABLE "Sale";
ALTER TABLE "new_Sale" RENAME TO "Sale";
CREATE INDEX "Sale_storeId_orderNumber_idx" ON "Sale"("storeId", "orderNumber");
CREATE INDEX "Sale_storeId_idx" ON "Sale"("storeId");
CREATE UNIQUE INDEX "Sale_storeId_sourceKey_key" ON "Sale"("storeId", "sourceKey");
CREATE TABLE "new_InventoryExpense" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "vendor" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "memo" TEXT,
    "importKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryExpense_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InventoryExpense" ("storeId", "amount", "createdAt", "date", "id", "importKey", "memo", "vendor") SELECT 'legacy', "amount", "createdAt", "date", "id", "importKey", "memo", "vendor" FROM "InventoryExpense";
DROP TABLE "InventoryExpense";
ALTER TABLE "new_InventoryExpense" RENAME TO "InventoryExpense";
CREATE INDEX "InventoryExpense_storeId_idx" ON "InventoryExpense"("storeId");
CREATE UNIQUE INDEX "InventoryExpense_storeId_importKey_key" ON "InventoryExpense"("storeId", "importKey");
CREATE TABLE "new_EbayFee" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "month" TEXT NOT NULL,
    "feeType" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "importKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EbayFee_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayFee" ("storeId", "amount", "createdAt", "description", "feeType", "id", "importKey", "month") SELECT 'legacy', "amount", "createdAt", "description", "feeType", "id", "importKey", "month" FROM "EbayFee";
DROP TABLE "EbayFee";
ALTER TABLE "new_EbayFee" RENAME TO "EbayFee";
CREATE INDEX "EbayFee_storeId_idx" ON "EbayFee"("storeId");
CREATE UNIQUE INDEX "EbayFee_storeId_importKey_key" ON "EbayFee"("storeId", "importKey");
CREATE TABLE "new_EbayFinanceTransaction" (
    "storeId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "transactionDate" DATETIME NOT NULL,
    "bookingEntry" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "feeDetails" TEXT,
    "orderId" TEXT,
    "payoutId" TEXT,
    "salesRecordRef" TEXT,
    "marketplaceId" TEXT NOT NULL,
    "rawPayload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EbayFinanceTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayFinanceTransaction" ("storeId", "accountId", "amount", "bookingEntry", "createdAt", "feeDetails", "id", "marketplaceId", "orderId", "payoutId", "rawPayload", "salesRecordRef", "transactionDate", "transactionId", "transactionType", "updatedAt") SELECT 'legacy', "accountId", "amount", "bookingEntry", "createdAt", "feeDetails", "id", "marketplaceId", "orderId", "payoutId", "rawPayload", "salesRecordRef", "transactionDate", "transactionId", "transactionType", "updatedAt" FROM "EbayFinanceTransaction";
DROP TABLE "EbayFinanceTransaction";
ALTER TABLE "new_EbayFinanceTransaction" RENAME TO "EbayFinanceTransaction";
CREATE INDEX "EbayFinanceTransaction_storeId_transactionDate_idx" ON "EbayFinanceTransaction"("storeId", "transactionDate");
CREATE INDEX "EbayFinanceTransaction_storeId_orderId_idx" ON "EbayFinanceTransaction"("storeId", "orderId");
CREATE INDEX "EbayFinanceTransaction_storeId_payoutId_idx" ON "EbayFinanceTransaction"("storeId", "payoutId");
CREATE INDEX "EbayFinanceTransaction_storeId_idx" ON "EbayFinanceTransaction"("storeId");
CREATE UNIQUE INDEX "EbayFinanceTransaction_storeId_accountId_transactionId_key" ON "EbayFinanceTransaction"("storeId", "accountId", "transactionId");
CREATE TABLE "new_EbayPayout" (
    "storeId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "payoutDate" DATETIME NOT NULL,
    "payoutStatus" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("storeId", "id"),
    CONSTRAINT "EbayPayout_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayPayout" ("storeId", "accountId", "amount", "createdAt", "id", "payoutDate", "payoutStatus", "rawPayload", "transactionCount", "updatedAt") SELECT 'legacy', "accountId", "amount", "createdAt", "id", "payoutDate", "payoutStatus", "rawPayload", "transactionCount", "updatedAt" FROM "EbayPayout";
DROP TABLE "EbayPayout";
ALTER TABLE "new_EbayPayout" RENAME TO "EbayPayout";
CREATE INDEX "EbayPayout_storeId_payoutDate_idx" ON "EbayPayout"("storeId", "payoutDate");
CREATE INDEX "EbayPayout_storeId_idx" ON "EbayPayout"("storeId");
CREATE TABLE "new_GeneralExpense" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneralExpense_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GeneralExpense" ("storeId", "amount", "category", "createdAt", "date", "description", "id", "vendor") SELECT 'legacy', "amount", "category", "createdAt", "date", "description", "id", "vendor" FROM "GeneralExpense";
DROP TABLE "GeneralExpense";
ALTER TABLE "new_GeneralExpense" RENAME TO "GeneralExpense";
CREATE INDEX "GeneralExpense_storeId_idx" ON "GeneralExpense"("storeId");
CREATE TABLE "new_Inventory" (
    "storeId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Inventory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Inventory" ("storeId", "brand", "condition", "cost", "createdAt", "id", "itemId", "location", "partNumber", "price", "pulledAt", "quantity", "sku", "soldAt", "title", "views", "watchers") SELECT 'legacy', "brand", "condition", "cost", "createdAt", "id", "itemId", "location", "partNumber", "price", "pulledAt", "quantity", "sku", "soldAt", "title", "views", "watchers" FROM "Inventory";
DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE INDEX "Inventory_storeId_idx" ON "Inventory"("storeId");
CREATE UNIQUE INDEX "Inventory_storeId_itemId_key" ON "Inventory"("storeId", "itemId");
CREATE UNIQUE INDEX "Inventory_storeId_sku_key" ON "Inventory"("storeId", "sku");
CREATE TABLE "new_EbayOrder" (
    "storeId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("storeId", "id"),
    CONSTRAINT "EbayOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayOrder" ("storeId", "adFee", "buyerEmail", "buyerUsername", "createdAt", "creationDate", "currency", "ebayFees", "finalValueFee", "fulfillmentHrefs", "id", "internationalFee", "lastModifiedDate", "legacyOrderId", "lineItems", "netProceeds", "orderFulfillmentStatus", "orderPaymentStatus", "pricingSummary", "sellerId", "syncedAt", "tax", "totalAmount", "updatedAt") SELECT 'legacy', "adFee", "buyerEmail", "buyerUsername", "createdAt", "creationDate", "currency", "ebayFees", "finalValueFee", "fulfillmentHrefs", "id", "internationalFee", "lastModifiedDate", "legacyOrderId", "lineItems", "netProceeds", "orderFulfillmentStatus", "orderPaymentStatus", "pricingSummary", "sellerId", "syncedAt", "tax", "totalAmount", "updatedAt" FROM "EbayOrder";
DROP TABLE "EbayOrder";
ALTER TABLE "new_EbayOrder" RENAME TO "EbayOrder";
CREATE INDEX "EbayOrder_storeId_idx" ON "EbayOrder"("storeId");
CREATE TABLE "new_EbayOffer" (
    "storeId" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EbayOffer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayOffer" ("storeId", "createdAt", "currency", "id", "lastSeenAt", "listingId", "price", "quantity", "sku", "status", "syncedAt", "updatedAt") SELECT 'legacy', "createdAt", "currency", "id", "lastSeenAt", "listingId", "price", "quantity", "sku", "status", "syncedAt", "updatedAt" FROM "EbayOffer";
DROP TABLE "EbayOffer";
ALTER TABLE "new_EbayOffer" RENAME TO "EbayOffer";
CREATE INDEX "EbayOffer_storeId_status_idx" ON "EbayOffer"("storeId", "status");
CREATE INDEX "EbayOffer_storeId_idx" ON "EbayOffer"("storeId");
CREATE UNIQUE INDEX "EbayOffer_storeId_listingId_key" ON "EbayOffer"("storeId", "listingId");
CREATE TABLE "new_EbayTrafficDay" (
    "storeId" TEXT NOT NULL,
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

    PRIMARY KEY ("storeId", "date", "marketplaceId"),
    CONSTRAINT "EbayTrafficDay_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayTrafficDay" ("storeId", "date", "impressionsSearch", "impressionsStore", "impressionsTotal", "marketplaceId", "reportUpdatedAt", "syncedAt", "transactions", "viewsDirect", "viewsOffEbay", "viewsOtherEbay", "viewsSearch", "viewsStore", "viewsTotal") SELECT 'legacy', "date", "impressionsSearch", "impressionsStore", "impressionsTotal", "marketplaceId", "reportUpdatedAt", "syncedAt", "transactions", "viewsDirect", "viewsOffEbay", "viewsOtherEbay", "viewsSearch", "viewsStore", "viewsTotal" FROM "EbayTrafficDay";
DROP TABLE "EbayTrafficDay";
ALTER TABLE "new_EbayTrafficDay" RENAME TO "EbayTrafficDay";
CREATE INDEX "EbayTrafficDay_storeId_date_idx" ON "EbayTrafficDay"("storeId", "date");
CREATE INDEX "EbayTrafficDay_storeId_idx" ON "EbayTrafficDay"("storeId");
CREATE TABLE "new_EbayTrafficListing" (
    "storeId" TEXT NOT NULL,
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

    PRIMARY KEY ("storeId", "date", "marketplaceId", "listingId"),
    CONSTRAINT "EbayTrafficListing_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayTrafficListing" ("storeId", "date", "impressionsSearch", "impressionsStore", "impressionsTotal", "listingId", "marketplaceId", "syncedAt", "title", "transactions", "truncated", "viewsSearch", "viewsStore", "viewsTotal") SELECT 'legacy', "date", "impressionsSearch", "impressionsStore", "impressionsTotal", "listingId", "marketplaceId", "syncedAt", "title", "transactions", "truncated", "viewsSearch", "viewsStore", "viewsTotal" FROM "EbayTrafficListing";
DROP TABLE "EbayTrafficListing";
ALTER TABLE "new_EbayTrafficListing" RENAME TO "EbayTrafficListing";
CREATE INDEX "EbayTrafficListing_storeId_listingId_idx" ON "EbayTrafficListing"("storeId", "listingId");
CREATE INDEX "EbayTrafficListing_storeId_date_idx" ON "EbayTrafficListing"("storeId", "date");
CREATE INDEX "EbayTrafficListing_storeId_idx" ON "EbayTrafficListing"("storeId");
CREATE TABLE "new_EbayPriceComparison" (
    "storeId" TEXT NOT NULL,
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
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EbayPriceComparison_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayPriceComparison" ("storeId", "avgPrice", "checkedAt", "competitorCount", "id", "maxPrice", "medianPrice", "minPrice", "priceDiff", "recommendation", "sampleListings", "sku", "title", "yourPrice") SELECT 'legacy', "avgPrice", "checkedAt", "competitorCount", "id", "maxPrice", "medianPrice", "minPrice", "priceDiff", "recommendation", "sampleListings", "sku", "title", "yourPrice" FROM "EbayPriceComparison";
DROP TABLE "EbayPriceComparison";
ALTER TABLE "new_EbayPriceComparison" RENAME TO "EbayPriceComparison";
CREATE INDEX "EbayPriceComparison_storeId_idx" ON "EbayPriceComparison"("storeId");
CREATE UNIQUE INDEX "EbayPriceComparison_storeId_sku_key" ON "EbayPriceComparison"("storeId", "sku");
CREATE TABLE "new_EbaySyncLock" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "EbaySyncLock_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbaySyncLock" ("storeId", "acquiredAt", "expiresAt", "id", "name", "owner") SELECT 'legacy', "acquiredAt", "expiresAt", "id", "name", "owner" FROM "EbaySyncLock";
DROP TABLE "EbaySyncLock";
ALTER TABLE "new_EbaySyncLock" RENAME TO "EbaySyncLock";
CREATE INDEX "EbaySyncLock_storeId_expiresAt_idx" ON "EbaySyncLock"("storeId", "expiresAt");
CREATE INDEX "EbaySyncLock_storeId_idx" ON "EbaySyncLock"("storeId");
CREATE UNIQUE INDEX "EbaySyncLock_storeId_name_key" ON "EbaySyncLock"("storeId", "name");
CREATE TABLE "new_EbaySyncSetting" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "lookbackDays" INTEGER NOT NULL DEFAULT 30,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EbaySyncSetting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbaySyncSetting" ("storeId", "createdAt", "domain", "enabled", "frequency", "id", "lastRunAt", "lookbackDays", "nextRunAt", "updatedAt") SELECT 'legacy', "createdAt", "domain", "enabled", "frequency", "id", "lastRunAt", "lookbackDays", "nextRunAt", "updatedAt" FROM "EbaySyncSetting";
DROP TABLE "EbaySyncSetting";
ALTER TABLE "new_EbaySyncSetting" RENAME TO "EbaySyncSetting";
CREATE INDEX "EbaySyncSetting_storeId_nextRunAt_idx" ON "EbaySyncSetting"("storeId", "nextRunAt");
CREATE INDEX "EbaySyncSetting_storeId_idx" ON "EbaySyncSetting"("storeId");
CREATE UNIQUE INDEX "EbaySyncSetting_storeId_domain_key" ON "EbaySyncSetting"("storeId", "domain");
CREATE TABLE "new_EbaySyncChunk" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runKey" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "rangeStart" DATETIME NOT NULL,
    "rangeEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "externalId" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EbaySyncChunk_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbaySyncChunk" ("storeId", "attempts", "createdAt", "cursor", "domain", "externalId", "id", "lastError", "rangeEnd", "rangeStart", "runKey", "status", "updatedAt") SELECT 'legacy', "attempts", "createdAt", "cursor", "domain", "externalId", "id", "lastError", "rangeEnd", "rangeStart", "runKey", "status", "updatedAt" FROM "EbaySyncChunk";
DROP TABLE "EbaySyncChunk";
ALTER TABLE "new_EbaySyncChunk" RENAME TO "EbaySyncChunk";
CREATE INDEX "EbaySyncChunk_storeId_domain_status_idx" ON "EbaySyncChunk"("storeId", "domain", "status");
CREATE INDEX "EbaySyncChunk_storeId_idx" ON "EbaySyncChunk"("storeId");
CREATE UNIQUE INDEX "EbaySyncChunk_storeId_runKey_rangeStart_rangeEnd_key" ON "EbaySyncChunk"("storeId", "runKey", "rangeStart", "rangeEnd");
CREATE TABLE "new_EbaySyncLog" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "EbaySyncLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbaySyncLog" ("storeId", "count", "finishedAt", "id", "message", "startedAt", "status", "type") SELECT 'legacy', "count", "finishedAt", "id", "message", "startedAt", "status", "type" FROM "EbaySyncLog";
DROP TABLE "EbaySyncLog";
ALTER TABLE "new_EbaySyncLog" RENAME TO "EbaySyncLog";
CREATE INDEX "EbaySyncLog_storeId_idx" ON "EbaySyncLog"("storeId");
CREATE TABLE "new_ListingNote" (
    "storeId" TEXT NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "listingId" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListingNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ListingNote" ("storeId", "createdAt", "id", "listingId", "note", "tags") SELECT 'legacy', "createdAt", "id", "listingId", "note", "tags" FROM "ListingNote";
DROP TABLE "ListingNote";
ALTER TABLE "new_ListingNote" RENAME TO "ListingNote";
CREATE INDEX "ListingNote_storeId_listingId_idx" ON "ListingNote"("storeId", "listingId");
CREATE INDEX "ListingNote_storeId_idx" ON "ListingNote"("storeId");
CREATE TABLE "new_EbayAccount" (
    "storeId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "environment" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL DEFAULT 'EBAY_US',
    "sellerId" TEXT,
    "username" TEXT,
    "refreshTokenCiphertext" TEXT NOT NULL,
    "refreshTokenIv" TEXT NOT NULL,
    "refreshTokenAuthTag" TEXT NOT NULL,
    "refreshTokenKeyVersion" TEXT NOT NULL,
    "refreshTokenExpiresAt" DATETIME,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "authorizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "lastContactAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EbayAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayAccount" ("storeId", "authorizedAt", "createdAt", "environment", "id", "lastContactAt", "marketplaceId", "refreshTokenAuthTag", "refreshTokenCiphertext", "refreshTokenExpiresAt", "refreshTokenIv", "refreshTokenKeyVersion", "revokedAt", "scopes", "sellerId", "status", "updatedAt", "username") SELECT 'legacy', "authorizedAt", "createdAt", "environment", "id", "lastContactAt", "marketplaceId", "refreshTokenAuthTag", "refreshTokenCiphertext", "refreshTokenExpiresAt", "refreshTokenIv", "refreshTokenKeyVersion", "revokedAt", "scopes", "sellerId", "status", "updatedAt", "username" FROM "EbayAccount";
DROP TABLE "EbayAccount";
ALTER TABLE "new_EbayAccount" RENAME TO "EbayAccount";
CREATE INDEX "EbayAccount_storeId_idx" ON "EbayAccount"("storeId");
CREATE UNIQUE INDEX "EbayAccount_storeId_environment_key" ON "EbayAccount"("storeId", "environment");
CREATE UNIQUE INDEX "EbayAccount_environment_sellerId_key" ON "EbayAccount"("environment", "sellerId");
CREATE UNIQUE INDEX "EbayAccount_storeId_id_key" ON "EbayAccount"("storeId", "id");
CREATE TABLE "new_EbayOAuthState" (
    "storeId" TEXT NOT NULL,
    "state" TEXT NOT NULL PRIMARY KEY,
    "environment" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestedScopes" TEXT NOT NULL,
    CONSTRAINT "EbayOAuthState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EbayOAuthState" ("storeId", "consumedAt", "createdAt", "environment", "expiresAt", "state") SELECT 'legacy', "consumedAt", "createdAt", "environment", "expiresAt", "state" FROM "EbayOAuthState";
DROP TABLE "EbayOAuthState";
ALTER TABLE "new_EbayOAuthState" RENAME TO "EbayOAuthState";
CREATE INDEX "EbayOAuthState_storeId_expiresAt_idx" ON "EbayOAuthState"("storeId", "expiresAt");
CREATE INDEX "EbayOAuthState_storeId_idx" ON "EbayOAuthState"("storeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "StoreMembership_userId_idx" ON "StoreMembership"("userId");

-- CreateIndex
CREATE INDEX "UserInvitation_userId_idx" ON "UserInvitation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentKey_tokenHash_key" ON "AgentKey"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentKey_storeId_idx" ON "AgentKey"("storeId");

-- CreateIndex
CREATE INDEX "ListingDraft_storeId_status_idx" ON "ListingDraft"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ListingDraft_storeId_id_key" ON "ListingDraft"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ListingDraft_storeId_listingId_key" ON "ListingDraft"("storeId", "listingId");

-- CreateIndex
CREATE INDEX "ListingAsset_storeId_idx" ON "ListingAsset"("storeId");

-- CreateIndex
CREATE INDEX "ListingOperation_storeId_status_idx" ON "ListingOperation"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ListingOperation_storeId_idempotencyKey_key" ON "ListingOperation"("storeId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditEvent_storeId_createdAt_idx" ON "AuditEvent"("storeId", "createdAt");
