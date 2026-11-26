import { describe, expect, it, vi } from 'vitest';
import { errorResponse } from './route-helpers';

const prismaError = (code: string) => Object.assign(new Error(`Invalid prisma invocation (${code})`), { code });

describe('errorResponse', () => {
  it('reports only a unique-constraint violation as a store/seller conflict', async () => {
    const response = errorResponse(prismaError('P2002'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('data_conflict');
  });

  it.each(['P2024', 'P2025', 'P2021', 'P1001'])('reports %s as a database error, not a conflict', async code => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = errorResponse(prismaError(code));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.code).toBe('database_error');
    expect(body.error).toContain(code);
    expect(body.error).not.toMatch(/Verify the selected store/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('leaves non-database errors with a code alone', async () => {
    const response = errorResponse(Object.assign(new Error('boom'), { code: 'ECONNRESET' }));
    expect((await response.json()).code).toBe('internal_error');
  });
});
