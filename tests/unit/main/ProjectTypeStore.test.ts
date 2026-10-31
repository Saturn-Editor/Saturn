import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectTypeStore } from '../../../src/main/Store/ProjectTypeStore';

describe('project type recents', () => {
  it('keeps recents per type, newest first, and reports missing folders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'saturn-types-'));
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    mkdirSync(a);
    const store = new ProjectTypeStore(join(dir, 'project-types.json'));
    await store.touch('diagrams', a, 'A');
    await store.touch('diagrams', b, 'B');
    const list = await store.list('diagrams');
    expect(list.map((p) => p.name)).toEqual(['B', 'A']);
    expect(list.find((p) => p.name === 'B')?.missing).toBe(true);
    expect(list.find((p) => p.name === 'A')?.missing).toBe(false);
    expect(await store.list('api')).toEqual([]);
    await store.remove('diagrams', b);
    expect((await store.list('diagrams')).map((p) => p.name)).toEqual(['A']);
  });
});
