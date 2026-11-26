-- Per-domain sync schedule, replacing the frequency that was hardcoded in the
-- systemd timer's OnCalendar. The timer now ticks hourly and this table
-- decides what is actually due.
CREATE TABLE "EbaySyncSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "lookbackDays" INTEGER NOT NULL DEFAULT 30,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "EbaySyncSetting_domain_key" ON "EbaySyncSetting"("domain");
CREATE INDEX "EbaySyncSetting_nextRunAt_idx" ON "EbaySyncSetting"("nextRunAt");

-- Seed orders with the schedule the operator already asked for and that the
-- timer has been running, so behaviour does not change on deploy.
INSERT INTO "EbaySyncSetting" ("domain", "enabled", "frequency", "lookbackDays", "updatedAt")
VALUES ('orders', true, 'weekly', 30, CURRENT_TIMESTAMP);
