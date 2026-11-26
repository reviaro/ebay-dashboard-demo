-- Removes the chunk rows left by the manual traffic backfill.
--
-- Manual backfill run keys encoded an explicit date range and stayed stable
-- across invocations. The sync now works out what is outstanding from the
-- stored rows instead, under two fixed keys, so those range-keyed rows will
-- never be looked at again, even if their status remains `pending`.
--
-- Leaving obsolete checkpoints behind would obscure current sync state.
--
-- Deleting them loses nothing. A chunk row is a checkpoint, not data; the
-- traffic itself is in EbayTrafficDay and EbayTrafficListing, and any day still
-- missing from those is rediscovered by the coverage query on the next run.
DELETE FROM "EbaySyncChunk"
WHERE "domain" = 'traffic'
  AND "runKey" NOT LIKE 'traffic:refresh:%'
  AND "runKey" NOT IN ('traffic:day:repair', 'traffic:listing:backfill');
