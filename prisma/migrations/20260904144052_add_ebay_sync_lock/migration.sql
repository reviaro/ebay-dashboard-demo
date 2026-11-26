-- CreateTable
CREATE TABLE "EbaySyncLock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "EbaySyncLock_name_key" ON "EbaySyncLock"("name");

-- CreateIndex
CREATE INDEX "EbaySyncLock_expiresAt_idx" ON "EbaySyncLock"("expiresAt");
