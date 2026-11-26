/** This module intentionally does not import the application's Prisma singleton. */
import { constants, existsSync, lstatSync, openSync, closeSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_DATE } from './config';

export const DEMO_DATABASE_URL = 'file:./demo.db';
export const DEMO_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function validateDemoDatabaseUrl(value: string | undefined): void {
  if (value !== undefined && value !== DEMO_DATABASE_URL) {
    throw new Error('Demo operation refused: DATABASE_URL must be unset or exactly file:./demo.db. No database was opened.');
  }
}

/** No arbitrary database destination is accepted. Reject aliases, links and escapes before opening. */
export function assertDemoDatabasePath(options: { create?: boolean; allowMissing?: boolean; requireManifestWhenExists?: boolean; rejectSidecars?: boolean; projectRoot?: string; databaseUrl?: string } = {}): string {
  validateDemoDatabaseUrl(options.databaseUrl ?? process.env.DATABASE_URL);
  const root = options.projectRoot ?? DEMO_PROJECT_ROOT;
  if (realpathSync(root) !== resolve(root)) throw new Error('Demo project root must not be a symlink or path alias.');
  const prismaDirectory = resolve(root, 'prisma');
  if (lstatSync(prismaDirectory).isSymbolicLink() || realpathSync(prismaDirectory) !== prismaDirectory) {
    throw new Error('Demo prisma directory must not be a symlink or escape the project.');
  }
  const schema = resolve(prismaDirectory, 'schema.prisma');
  if (lstatSync(schema).isSymbolicLink() || !lstatSync(schema).isFile()) throw new Error('Demo schema must be a regular file.');
  const database = resolve(prismaDirectory, 'demo.db');
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const candidate = database + suffix;
    // lstat also detects broken symlinks; existsSync alone does not.
    let stat;
    try { stat = lstatSync(candidate); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || realpathSync(candidate) !== candidate) {
      throw new Error(`Demo database safety check refused an unsafe ${suffix || 'database'} file.`);
    }
    if (suffix && options.rejectSidecars) throw new Error('Stop the server and remove the demo database sidecars before reseeding.');
  }
  if (options.requireManifestWhenExists && existsSync(database)) validateDemoManifest(database);
  if (!existsSync(database) && options.create) {
    const fd = openSync(database, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    closeSync(fd);
  }
  if (!options.allowMissing && !existsSync(database)) throw new Error('Demo database is missing. Run npm run seed:demo.');
  return database;
}

export interface DemoManifest { schemaVersion: 1; synthetic: true; asOf: string; sha256: string }
function manifestPath(database: string): string {
  const path = resolve(dirname(database), 'demo-manifest.json');
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error('Demo manifest must be a regular, unlinked local file.');
  }
  return path;
}
export function demoDatabaseSha256(database: string): string {
  return createHash('sha256').update(readFileSync(database)).digest('hex');
}
export function validateDemoManifest(database: string): DemoManifest {
  const path = manifestPath(database);
  if (!existsSync(path)) throw new Error('Refusing to overwrite an existing demo.db without a matching synthetic demo manifest. Move that file aside yourself before seeding.');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as DemoManifest;
  if (manifest.schemaVersion !== 1 || manifest.synthetic !== true || manifest.asOf !== DEMO_DATE || manifest.sha256 !== demoDatabaseSha256(database)) {
    throw new Error('Refusing to overwrite demo.db: its synthetic manifest is invalid or its file checksum changed.');
  }
  return manifest;
}
export function writeDemoManifest(database: string): DemoManifest {
  const manifest: DemoManifest = { schemaVersion: 1, synthetic: true, asOf: DEMO_DATE, sha256: demoDatabaseSha256(database) };
  const path = manifestPath(database);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(manifest, null, 2) + '\n'); } finally { closeSync(fd); }
  return manifest;
}
