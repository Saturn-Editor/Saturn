import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestSetStore } from '../../../src/main/Store/TestSetStore';

const project = () => mkdtempSync(join(tmpdir(), 'saturn-sets-'));

describe('test sets', () => {
  it('saves, replaces and removes sets per project, in its .saturn folder', async () => {
    const sets = new TestSetStore();
    const p = project();
    await sets.save(p, { name: 'Smoke', tests: [{ controllerId: 'c', id: 'a' }] });
    await sets.save(p, { name: 'All', tests: [{ controllerId: 'c', id: 'a' }, { controllerId: 'c', id: 'b' }] });
    await sets.save(p, { name: 'Smoke', tests: [{ controllerId: 'c', id: 'b' }] });
    expect(await sets.list(p)).toEqual([
      { name: 'All', tests: [{ controllerId: 'c', id: 'a' }, { controllerId: 'c', id: 'b' }] },
      { name: 'Smoke', tests: [{ controllerId: 'c', id: 'b' }] },
    ]);
    expect(existsSync(join(p, '.saturn', 'test-sets.json'))).toBe(true);
    expect(await sets.list(project())).toEqual([]);
    expect((await sets.remove(p, 'All')).map((s) => s.name)).toEqual(['Smoke']);
  });

  it('needs a name and at least one test', async () => {
    await expect(new TestSetStore().save(project(), { name: ' ', tests: [{ controllerId: 'c', id: 'a' }] })).rejects.toThrow('name');
    await expect(new TestSetStore().save(project(), { name: 'Empty', tests: [] })).rejects.toThrow('Select some tests');
  });
});
