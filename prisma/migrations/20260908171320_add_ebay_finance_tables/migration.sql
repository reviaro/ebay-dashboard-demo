-- CreateTable
CREATE TABLE "EbayFinanceTransaction" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EbayPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "payoutDate" DATETIME NOT NULL,
    "payoutStatus" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "EbayFinanceTransaction_transactionDate_idx" ON "EbayFinanceTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "EbayFinanceTransaction_orderId_idx" ON "EbayFinanceTransaction"("orderId");

-- CreateIndex
CREATE INDEX "EbayFinanceTransaction_payoutId_idx" ON "EbayFinanceTransaction"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "EbayFinanceTransaction_accountId_transactionId_key" ON "EbayFinanceTransaction"("accountId", "transactionId");

-- CreateIndex
CREATE INDEX "EbayPayout_payoutDate_idx" ON "EbayPayout"("payoutDate");
