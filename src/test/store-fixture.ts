import { it as baseIt } from 'vitest';
import { runInStore } from '../lib/stores/context';

export const fixtureStore = { storeId: 'legacy', actorId: 'test-user', role: 'admin' as const, sessionId: 'test-session', marketplaceId: 'EBAY_US' };
// Business-unit tests explicitly run in an authorized fixture store. Security
// tests use the real boundary without this helper. Wrap the test callback
// itself: Vitest fixture setup does not propagate AsyncLocalStorage to a test.
function scopedTest(test: typeof baseIt): typeof baseIt {
  return new Proxy(test, {
    apply(target, receiver, args) {
      const wrapped = [...args];
      const index = wrapped.findIndex((value, i) => i > 0 && typeof value === 'function');
      if (index >= 0) {
        const callback = wrapped[index];
        wrapped[index] = (...values: unknown[]) => runInStore(fixtureStore, () => callback(...values));
      }
      return Reflect.apply(target, receiver, wrapped);
    },
    get(target, key, receiver) {
      if (key === 'each') return (...args: unknown[]) => scopedTest(Reflect.apply(Reflect.get(target, key, receiver), target, args));
      return Reflect.get(target, key, receiver);
    },
  });
}
export const it = scopedTest(baseIt);
export function withUnitStore<C>(_: unknown, handler: (request: Request, context: C) => Promise<Response>) {
  return (request: Request, context: C) => runInStore(fixtureStore, () => handler(request, context));
}
