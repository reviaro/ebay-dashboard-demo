-- CreateTable
CREATE TABLE "EbayAccount" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EbayOAuthState" (
    "state" TEXT NOT NULL PRIMARY KEY,
    "environment" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayAccount_environment_key" ON "EbayAccount"("environment");

-- CreateIndex
CREATE INDEX "EbayOAuthState_expiresAt_idx" ON "EbayOAuthState"("expiresAt");
