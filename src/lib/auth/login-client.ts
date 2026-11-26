/** Node-only login client identity. Forwarded headers are never trusted alone. */
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

// Counters are process-local; this salt keeps addresses out of their keys.
const identitySalt = randomBytes(32);
const MAX_PROXY_HOPS = 16;

export class LoginClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginClientError';
  }
}

/** Canonicalize IPv6, including both spellings of IPv4-mapped addresses. */
export function normalizeAddress(raw: string): string | null {
  const address = raw.trim();
  if (address.includes('%') || !isIP(address)) return null;
  if (isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
}

function trustedAddresses(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  const values = raw.split(',');
  if (values.length > MAX_PROXY_HOPS) {
    throw new LoginClientError('Login proxy configuration is invalid.');
  }
  const addresses = values.map(normalizeAddress);
  if (addresses.some((address) => !address)) {
    throw new LoginClientError('Login proxy configuration requires exact IP addresses.');
  }
  return new Set(addresses as string[]);
}

export function loginClientKey(
  request: Pick<IncomingMessage, 'socket' | 'headers'>,
  trustedProxyIps: string | undefined = process.env.DASHBOARD_TRUSTED_PROXY_IPS
): string {
  const trusted = trustedAddresses(trustedProxyIps);
  let address = normalizeAddress(request.socket.remoteAddress ?? '');
  if (!address) throw new LoginClientError('Login client identity is unavailable.');

  // Direct callers cannot choose their bucket with X-Forwarded-For, X-Real-IP,
  // cookies, or custom headers. Only a configured socket peer may forward it.
  if (trusted.has(address)) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded !== 'string' || forwarded.length > 1024) {
      throw new LoginClientError('Login proxy must provide a client address.');
    }
    const chain = forwarded.split(',');
    if (chain.length > MAX_PROXY_HOPS) {
      throw new LoginClientError('Login proxy address chain is invalid.');
    }
    // Walk inward from the actual peer. Ignore anything supplied to the left
    // of the first untrusted hop, including attacker-supplied fake addresses.
    for (let index = chain.length - 1; index >= 0 && trusted.has(address); index--) {
      const candidate = normalizeAddress(chain[index]);
      if (!candidate) throw new LoginClientError('Login proxy address chain is invalid.');
      address = candidate;
    }
    if (trusted.has(address)) {
      throw new LoginClientError('Login proxy must provide a client address.');
    }
  }

  return createHmac('sha256', identitySalt).update(address).digest('hex');
}
