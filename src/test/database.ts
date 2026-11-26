import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Apply the actual migration chain, with fsync disabled ONLY on disposable test databases. */
export function migrateTestDatabase(directory: string): void {
  execFileSync('python3', ['-c', `
import pathlib,sqlite3,sys
root=pathlib.Path(sys.argv[1])
db=sqlite3.connect(root/'prisma/test.db')
db.execute('PRAGMA journal_mode=MEMORY')
db.execute('PRAGMA synchronous=OFF')
for migration in sorted((root/'prisma/migrations').glob('*/migration.sql')):
    db.executescript(migration.read_text())
assert not db.execute('PRAGMA foreign_key_check').fetchall()
db.close()
`, directory], { stdio: 'pipe', timeout: 30000 });
}
export const testDatabaseUrl = (directory: string) => `file:${join(directory, 'prisma/test.db')}`;
