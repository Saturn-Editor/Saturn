import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppPaths } from '../../../src/main/Helpers/AppPaths';
import { TestSetStore } from '../../../src/main/Store/TestSetStore';

const store = () => new TestSetStore(new AppPaths(mkdtempSync(join(tmpdir(), 'saturn-sets-'))));

describe('test sets', () => {
  it('saves, replaces and removes sets per project', async () => {
    const sets = store();
    await sets.save('/p', { name: 'Smoke', tests: [{ controllerId: 'c', id: 'a' }] });
    await sets.save('/p', { name: 'All', tests: [{ controllerId: 'c', id: 'a' }, { controllerId: 'c', id: 'b' }] });
    await sets.save('/p', { name: 'Smoke', tests: [{ controllerId: 'c', id: 'b' }] });
    expect(await sets.list('/p')).toEqual([
      { name: 'All', tests: [{ controllerId: 'c', id: 'a' }, { controllerId: 'c', id: 'b' }] },
      { name: 'Smoke', tests: [{ controllerId: 'c', id: 'b' }] },
    ]);
    expect(await sets.list('/other')).toEqual([]);
    expect((await sets.remove('/p', 'All')).map((s) => s.name)).toEqual(['Smoke']);
  });

  it('needs a name and at least one test', async () => {
    await expect(store().save('/p', { name: ' ', tests: [{ controllerId: 'c', id: 'a' }] })).rejects.toThrow('name');
    await expect(store().save('/p', { name: 'Empty', tests: [] })).rejects.toThrow('Select some tests');
  });
});
