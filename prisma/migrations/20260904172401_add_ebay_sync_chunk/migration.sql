-- Per-chunk checkpoints, so an interrupted chunked sync resumes rather than
-- redoing committed work or skipping it. Unused by orders (a 90-day run takes
-- about a second); built for Phase 6's asynchronous report tasks.
CREATE TABLE "EbaySyncChunk" (
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
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "EbaySyncChunk_runKey_rangeStart_rangeEnd_key"
    ON "EbaySyncChunk"("runKey", "rangeStart", "rangeEnd");
CREATE INDEX "EbaySyncChunk_domain_status_idx" ON "EbaySyncChunk"("domain", "status");
