/**
 * Sets up dashboard authentication in `.env.local`.
 *
 *   npm run auth:hash                        # interactive, needs a real TTY
 *   npm run auth:hash -- --from-file <path>  # read the password from a file
 *
 * Interactively, the password is read with echo suppressed. Some environments
 * (an agent harness, a CI shell, anything without a controlling terminal)
 * cannot type into a prompt at all -- there `--from-file` takes the password
 * from a file written by an editor, then securely deletes that file. Both
 * routes keep the plaintext out of shell history, the process list, and logs.
 * A password passed as a command-line ARGUMENT is deliberately not supported:
 * it would be visible in `ps` and land in shell history.
 *
 * Only the scrypt hash is written. `DASHBOARD_SESSION_SECRET` is generated too
 * if not already set.
 *
 * Run via `npm run auth:hash`, which supplies the TypeScript resolver hook.
 */

import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  hashPassword,
  MINIMUM_PASSWORD_LENGTH,
  verifyPassword,
} from '../src/lib/auth/password';
import { hasEnvValue, upsertEnvValue } from '../src/lib/auth/env-file';

const ENV_PATH = new URL('../.env.local', import.meta.url).pathname;

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return new Promise((resolve) => {
    type Writable = { _writeToOutput: (chunk: string) => void };
    const internals = rl as unknown as Writable;
    const passthrough = internals._writeToOutput.bind(rl);
    let muted = false;

    rl.question(question, (answer) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });

    // Muting is installed only AFTER `question()` has written the prompt.
    // Overriding it beforehand swallows the prompt itself, which makes the
    // script look hung when it is really waiting for input.
    internals._writeToOutput = (chunk: string) => {
      if (!muted) passthrough(chunk);
    };
    muted = true;
  });
}

/** Overwrites the file's bytes before unlinking, so the plaintext is not left in free space. */
function shred(path: string): void {
  try {
    const size = statSync(path).size;
    writeFileSync(path, randomBytes(Math.max(size, 32)));
  } catch {
    // Best effort; the unlink below is what matters most.
  }
  unlinkSync(path);
}

function readPasswordFile(path: string): string {
  if (!existsSync(path)) {
    console.error(`No such file: ${path}`);
    process.exit(1);
  }

  // First line only, so a trailing newline from an editor is not part of the
  // password. Everything after the first line is ignored.
  const password = readFileSync(path, 'utf8').split(/\r?\n/)[0];

  if (password.trim().length === 0) {
    console.error(`${path} is empty. Nothing was written.`);
    process.exit(1);
  }

  return password;
}

async function main() {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf('--from-file');
  const fromFile = fileFlag !== -1 ? args[fileFlag + 1] : undefined;

  if (fileFlag !== -1 && !fromFile) {
    console.error('--from-file needs a path.');
    process.exit(1);
  }

  let password: string;
  let passwordFileToShred: string | undefined;

  if (fromFile) {
    password = readPasswordFile(fromFile);
    passwordFileToShred = fromFile;
  } else {
    if (!process.stdin.isTTY) {
      console.error(
        'No terminal available to prompt for a password.\n' +
          'Write the password into a file with your editor, then run:\n' +
          '  npm run auth:hash -- --from-file /path/to/file\n' +
          '(the file is securely deleted afterwards).'
      );
      process.exit(1);
    }

    password = await prompt('New dashboard password: ');

    // Checked before the confirmation prompt: rejecting a too-short password
    // only after it has been typed twice is needless work for the operator.
    if (password.trim().length < MINIMUM_PASSWORD_LENGTH) {
      console.error(
        `\nPassword must be at least ${MINIMUM_PASSWORD_LENGTH} characters. Nothing was written.`
      );
      process.exit(1);
    }

    const again = await prompt('Repeat password:        ');

    if (password !== again) {
      console.error('\nThe two entries do not match. Nothing was written.');
      process.exit(1);
    }
  }

  let hash: string;
  try {
    hash = hashPassword(password);
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Prove the stored hash accepts the password before writing it, so a broken
  // hash can never be the thing that locks the operator out.
  if (!verifyPassword(password, hash)) {
    console.error('\nInternal error: the generated hash did not verify. Nothing was written.');
    process.exit(1);
  }

  let contents = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';

  if (existsSync(ENV_PATH)) {
    const backup = `${ENV_PATH}.backup-${new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 15)}`;
    copyFileSync(ENV_PATH, backup);
    console.log(`\nBacked up existing .env.local to ${backup.split('/').pop()}`);
  }

  contents = upsertEnvValue(contents, 'DASHBOARD_PASSWORD_HASH', hash);

  let generatedSecret = false;
  if (!hasEnvValue(contents, 'DASHBOARD_SESSION_SECRET')) {
    contents = upsertEnvValue(
      contents,
      'DASHBOARD_SESSION_SECRET',
      randomBytes(32).toString('base64')
    );
    generatedSecret = true;
  }

  writeFileSync(ENV_PATH, contents, { mode: 0o600 });
  chmodSync(ENV_PATH, 0o600);

  console.log('Wrote DASHBOARD_PASSWORD_HASH to .env.local');
  if (generatedSecret) {
    console.log('Generated DASHBOARD_SESSION_SECRET (32 random bytes)');
  } else {
    console.log('Kept the existing DASHBOARD_SESSION_SECRET');
  }

  if (passwordFileToShred) {
    shred(passwordFileToShred);
    console.log(`Securely deleted ${passwordFileToShred}`);
  }

  console.log('\nActivate it with a restart (no rebuild needed for env values):');
  console.log('\n  systemctl --user restart ebay-dashboard\n');
}

main();
