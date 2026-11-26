/** Server authorization uses only this runtime environment variable. */
import { DEMO_AS_OF } from './config';

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

/** Fixed reporting clock; real authentication/token clocks are never frozen. */
export function reportingNow(): Date {
  return isDemoMode() ? new Date(DEMO_AS_OF) : new Date();
}

export function assertLiveIntegrationAllowed(): void {
  if (isDemoMode()) throw new Error('External integrations and background writes are disabled in demo mode.');
}
