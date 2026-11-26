import { describe, expect, it } from 'vitest';
import { LoginRateLimiter, LoginWorkLimiter } from './rate-limit';

function limiter() {
  return new LoginRateLimiter({
    maxAttempts: 3,
    windowSeconds: 300,
    lockoutSeconds: 900,
  });
}

describe('LoginRateLimiter', () => {
  it('allows an attempt from a client with no history', () => {
    expect(limiter().check('client-a', 1000).allowed).toBe(true);
  });

  it('still allows the attempt that reaches the limit', () => {
    const rl = limiter();
    rl.recordFailure('client-a', 1000);
    rl.recordFailure('client-a', 1001);

    expect(rl.check('client-a', 1002).allowed).toBe(true);
  });

  it('locks out once the failure limit is reached', () => {
    const rl = limiter();
    for (let i = 0; i < 3; i++) rl.recordFailure('client-a', 1000 + i);

    expect(rl.check('client-a', 1010).allowed).toBe(false);
  });

  it('reports how long the caller must wait', () => {
    const rl = limiter();
    for (let i = 0; i < 3; i++) rl.recordFailure('client-a', 1000);

    // Locked at t=1000 for 900s, asked at t=1100 -> 800s remaining.
    expect(rl.check('client-a', 1100).retryAfterSeconds).toBe(800);
  });

  it('allows attempts again once the lockout expires', () => {
    const rl = limiter();
    for (let i = 0; i < 3; i++) rl.recordFailure('client-a', 1000);

    expect(rl.check('client-a', 1901).allowed).toBe(true);
  });

  it('forgets failures that fall outside the sliding window', () => {
    const rl = limiter();
    rl.recordFailure('client-a', 1000);
    rl.recordFailure('client-a', 1100);
    // The first two are now older than the 300s window.
    rl.recordFailure('client-a', 1500);

    expect(rl.check('client-a', 1500).allowed).toBe(true);
  });

  it('clears the failure count on a successful login', () => {
    const rl = limiter();
    for (let i = 0; i < 3; i++) rl.recordFailure('client-a', 1000);
    rl.recordSuccess('client-a');

    expect(rl.check('client-a', 1001).allowed).toBe(true);
  });

  it('tracks clients independently', () => {
    const rl = limiter();
    for (let i = 0; i < 3; i++) rl.recordFailure('client-a', 1000);

    expect(rl.check('client-b', 1001).allowed).toBe(true);
  });

  it('does not grow without bound as clients come and go', () => {
    const rl = limiter();
    for (let i = 0; i < 5000; i++) rl.recordFailure(`client-${i}`, 1000);
    // Everything above is long expired by now; one live attempt should prune.
    rl.recordFailure('client-a', 100_000);

    expect(rl.size).toBeLessThan(100);
  });
});


describe('bounded limiter state', () => {
  it('refuses new clients at capacity without evicting a locked client', () => {
    const rl = new LoginRateLimiter({ maxClients: 2, maxAttempts: 1, lockoutSeconds: 10 });
    rl.recordFailure('a', 100);
    rl.recordFailure('b', 100);
    expect(rl.check('c', 101).allowed).toBe(false);
    for (let index = 0; index < 100; index++) rl.recordFailure(`other-${index}`, 101);
    expect(rl.size).toBe(2);
    expect(rl.check('a', 101).allowed).toBe(false);
    expect(rl.check('c', 111).allowed).toBe(true);
    rl.recordFailure('c', 111);
    expect(rl.size).toBe(1);
  });

  it('a success removes only the matching client history', () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1 });
    rl.recordFailure('a', 100);
    rl.recordFailure('b', 100);
    rl.recordSuccess('a');
    expect(rl.check('a', 101).allowed).toBe(true);
    expect(rl.check('b', 101).allowed).toBe(false);
  });
});

describe('LoginWorkLimiter', () => {
  it('bounds work across clients and recovers within seconds without extending denial', () => {
    const budget = new LoginWorkLimiter(2, 5);
    expect(budget.take(100).allowed).toBe(true);
    expect(budget.take(101).allowed).toBe(true);
    expect(budget.take(102)).toEqual({ allowed: false, retryAfterSeconds: 3 });
    expect(budget.take(104)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(budget.take(105).allowed).toBe(true);
  });
});
