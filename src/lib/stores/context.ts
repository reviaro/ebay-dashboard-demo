import { AsyncLocalStorage } from 'node:async_hooks';

export type StoreRole = 'admin' | 'publisher' | 'editor' | 'viewer';
export type StorePermission = 'view' | 'edit' | 'publish' | 'admin';
export interface StoreContext {
  storeId: string;
  actorId: string;
  role: StoreRole;
  sessionId?: string;
  marketplaceId?: string;
  agent?: boolean;
}

const contexts = new AsyncLocalStorage<StoreContext>();

export function hasPermission(role: string, permission: StorePermission): boolean {
  const levels: Record<string, number> = { viewer: 0, editor: 1, publisher: 2, admin: 3 };
  const required = { view: 0, edit: 1, publish: 2, admin: 3 };
  return role in levels && levels[role] >= required[permission];
}

export function requireStoreContext(): StoreContext {
  const context = contexts.getStore();
  if (!context?.storeId) throw new Error('Store context is required. Refusing an unscoped operation.');
  return context;
}

export function requireStoreId(): string { return requireStoreContext().storeId; }

/** Explicit ownership for Prisma create inputs and compound unique keys. */
export function withStoreData<T extends object>(value: T): T & { storeId: string } {
  const storeId = requireStoreId();
  if ('storeId' in value && value.storeId !== storeId) throw new Error('Store mismatch.');
  return { ...value, storeId };
}

export function runInStore<T>(context: StoreContext, work: () => T): T {
  if (!context.storeId) throw new Error('A store ID is required.');
  return contexts.run(Object.freeze({ ...context }), () => {
    const result = work();
    // Prisma queries are lazy thenables. Start them while the store context is
    // active, even when the caller returns a query directly from this callback.
    return result && typeof (result as { then?: unknown }).then === 'function' ? Promise.resolve(result) as T : result;
  });
}
