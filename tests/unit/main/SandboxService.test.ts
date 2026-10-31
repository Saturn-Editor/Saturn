import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({}) } }));

const { clampTimeout, wrapScript } = await import('../../../src/main/Services/SandboxService');

describe('script sandbox', () => {
  it('uses 5 seconds by default and never more than 30', () => {
    expect(clampTimeout(undefined)).toBe(5000);
    expect(clampTimeout(-1)).toBe(5000);
    expect(clampTimeout(1000)).toBe(1000);
    expect(clampTimeout(120000)).toBe(30000);
  });

  it('returns the script result as JSON and removes network APIs first', async () => {
    const script = wrapScript('return { total: 1 + 2, fetch: typeof fetch, ws: typeof WebSocket };');
    expect(JSON.parse(await (0, eval)(script))).toEqual({ total: 3, fetch: 'undefined', ws: 'undefined' });
  });

  it('turns a script with no return value into null', async () => {
    expect(JSON.parse(await (0, eval)(wrapScript('const x = 1;')))).toBeNull();
  });
});
