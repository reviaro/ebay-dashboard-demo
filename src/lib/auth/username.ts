/**
 * The one definition of a valid dashboard username, shared by login, member
 * invitation and owner bootstrap. If these disagreed, a user could be created
 * who is then unable to sign in. Dependency-free so `scripts/` can import it.
 */
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;

/** Trimmed and lowercased, or `''` when the input is not a string. */
export const normalizeUsername = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');
export const isValidUsername = (username: string): boolean => USERNAME.test(username);
