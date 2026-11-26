-- Drops the unused legacy `EbaySyncConfig` key/value table.
--
-- Authentication data belongs in `EbayAccount`, where refresh tokens are
-- stored as AES-256-GCM envelopes instead of arbitrary plaintext values.
--
-- Dropping a credential-bearing table does NOT invalidate any token. Only
-- revoking the application's access at eBay does that, which
-- is an action on the seller's account, not something a migration can do.
DROP TABLE "EbaySyncConfig";
