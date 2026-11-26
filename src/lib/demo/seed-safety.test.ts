import { afterEach, describe, expect, it } from 'vitest';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDemoDatabasePath, validateDemoDatabaseUrl, validateDemoManifest, writeDemoManifest } from './seed-safety';
const roots: string[] = [];
const tree = () => { const root = mkdtempSync(join(tmpdir(), 'demo-seed-safety-')); roots.push(root); mkdirSync(join(root, 'prisma')); writeFileSync(join(root, 'prisma/schema.prisma'), '// synthetic test'); return root; };
const inspect = (projectRoot: string, extras = {}) => assertDemoDatabasePath({ projectRoot, databaseUrl: 'file:./demo.db', ...extras });
afterEach(() => { for (const root of roots.splice(0)) { rmSync(root, { recursive: true, force: true }); } });

describe('fail-closed demo seed destination', () => {
  it('accepts only an absent DATABASE_URL or the exact literal demo URL', () => {
    expect(() => validateDemoDatabaseUrl(undefined)).not.toThrow();
    expect(() => validateDemoDatabaseUrl('file:./demo.db')).not.toThrow();
    for (const value of ['', 'file:./dev.db', 'file:./demo.db?mode=ro', 'file:/tmp/demo.db', 'file:../demo.db', ' file:./demo.db', 'postgres://server/live']) {
      expect(() => validateDemoDatabaseUrl(value)).toThrow('DATABASE_URL');
    }
  });
  it('creates only prisma/demo.db and leaves neighboring databases untouched', () => {
    const root = tree(); const real = join(root, 'prisma/dev.db'); writeFileSync(real, 'never touch');
    expect(inspect(root, { create: true, requireManifestWhenExists: true })).toBe(join(root, 'prisma/demo.db'));
    expect(readFileSync(real, 'utf8')).toBe('never touch');
  });
  it('refuses unknown existing bytes without a manifest and after a checksum change', () => {
    const root = tree(), path = join(root, 'prisma/demo.db'); writeFileSync(path, 'unknown database');
    expect(() => inspect(root, { create: true, requireManifestWhenExists: true })).toThrow('manifest');
    expect(readFileSync(path, 'utf8')).toBe('unknown database');
    writeDemoManifest(path);
    expect(validateDemoManifest(path).synthetic).toBe(true);
    expect(() => inspect(root, { requireManifestWhenExists: true })).not.toThrow();
    writeFileSync(path, 'changed database');
    expect(() => inspect(root, { requireManifestWhenExists: true })).toThrow('checksum');
  });
  it('refuses linked databases, broken symlinks, nonregular files and linked sidecars', () => {
    for (const mode of ['symlink', 'broken', 'hardlink', 'directory', 'wal', 'manifest'] as const) {
      const root = tree(), path = join(root, 'prisma/demo.db'), other = join(root, 'private.db'); writeFileSync(other, 'do not touch');
      if (mode === 'symlink') symlinkSync(other, path);
      if (mode === 'broken') symlinkSync(join(root, 'absent.db'), path);
      if (mode === 'hardlink') linkSync(other, path);
      if (mode === 'directory') mkdirSync(path);
      if (mode === 'wal' || mode === 'manifest') {
        writeFileSync(path, 'fixture');
        symlinkSync(other, mode === 'wal' ? path + '-wal' : join(root, 'prisma/demo-manifest.json'));
      }
      expect(() => inspect(root, { create: true, requireManifestWhenExists: true })).toThrow();
      expect(readFileSync(other, 'utf8')).toBe('do not touch');
    }
  });
  it('refuses a symlinked prisma directory and project-root aliases', () => {
    const root = tree(); rmSync(join(root, 'prisma'), { recursive: true }); mkdirSync(join(root, 'elsewhere')); symlinkSync(join(root, 'elsewhere'), join(root, 'prisma'));
    expect(() => inspect(root, { create: true })).toThrow('prisma directory');
    const alias = root + '-alias'; symlinkSync(root, alias); roots.push(alias);
    expect(() => inspect(alias, { create: true })).toThrow('project root');
  });
});
