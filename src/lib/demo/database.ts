import { lstatSync, realpathSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEMO_DATE } from './config';
import { resolve } from 'node:path';

export const DEMO_DATABASE_URL = 'file:./demo.db';

/** Explicit isolation: demo mode can never silently use DATABASE_URL for a real store. */
export function demoDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (process.getuid?.() === 0) throw new Error('Demo mode must run as a non-root user.');
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== DEMO_DATABASE_URL) {
    throw new Error('Demo mode only accepts DATABASE_URL=file:./demo.db (or unset). Remove the other database setting.');
  }
  const root = realpathSync(process.cwd());
  const directory = resolve(root, 'prisma');
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error('Demo database directory must not be a symlink.');
  }
  const database = resolve(directory, 'demo.db');
  try {
    const info = lstatSync(database);
    if (!info.isFile() || info.nlink !== 1 || info.isSymbolicLink() || realpathSync(database) !== database) {
      throw new Error('Demo database must be an unlinked regular file inside prisma.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Demo database is missing. Run npm run seed:demo first.');
    }
    throw error;
  }
  if ((lstatSync(database).mode & 0o222) !== 0) {
    throw new Error('Demo database must have read-only permissions. Run npm run seed:demo.');
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    // A WAL could change the apparent data without changing the main file hash.
    try { lstatSync(database + suffix); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('Demo database sidecars are not allowed. Stop the server and reseed.');
  }
  const manifestPath = resolve(directory, 'demo-manifest.json');
  if (!existsSync(manifestPath)) throw new Error('Demo provenance is missing. Run npm run seed:demo.');
  const manifestStat = lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.nlink !== 1) {
    throw new Error('Demo provenance must be a regular, unlinked file.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sha256 = createHash('sha256').update(readFileSync(database)).digest('hex');
  if (manifest.schemaVersion !== 1 || manifest.synthetic !== true || manifest.asOf !== DEMO_DATE || manifest.sha256 !== sha256) {
    throw new Error('Demo database provenance does not match. Refusing to open it.');
  }
  // Prisma's SQLite engine does not honor URI mode=ro. The query allowlist is
  // the runtime boundary; read-only file permissions add OS enforcement when
  // running as a non-root account (the recommended configuration).
  return `file:${database}`;
}

export const DEMO_READ_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy',
]);

export function assertDemoReadOperation(model: string | undefined, operation: string): void {
  if (!model || !DEMO_READ_OPERATIONS.has(operation)) {
    throw new Error('Demo database accepts only model reads.');
  }
}
