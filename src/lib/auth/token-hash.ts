import { createHash } from 'node:crypto';

/** SHA-256 hex of an agent key or invitation token; only the hash is stored. Dependency-free so `scripts/` can import it. */
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
