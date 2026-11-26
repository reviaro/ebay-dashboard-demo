import { isDemoMode } from './lib/demo/server';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && isDemoMode()) {
    const { demoDatabaseUrl } = await import('./lib/demo/database');
    try {
      demoDatabaseUrl();
    } catch (error) {
      // Next can keep its listener open after a rejected instrumentation hook.
      // Exit the process so an invalid snapshot never leaves a running server.
      console.error(error instanceof Error ? error.message : 'Demo database validation failed.');
      process.exit(1);
    }
  }
}
