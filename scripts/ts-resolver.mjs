/**
 * Lets plain `node` run the repo's TypeScript scripts.
 *
 * Node 24 strips types on its own, but under ESM it still demands a file
 * extension on every relative specifier -- while the app's imports are
 * extensionless, because webpack and vitest both resolve them. Rather than
 * write `.ts` into application source purely to satisfy the CLI, this hook
 * retries a failed relative resolution with `.ts` appended.
 *
 * Usage:  node --import ./scripts/ts-resolver.mjs scripts/<name>.ts
 */

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
      if (existsSync(fileURLToPath(`${specifier}.ts`))) return nextResolve(`${specifier}.ts`, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || !context.parentURL) throw error;

      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        const resolved = new URL(candidate, context.parentURL);
        if (existsSync(fileURLToPath(resolved))) {
          return nextResolve(candidate, context);
        }
      }

      throw error;
    }
  },
});
