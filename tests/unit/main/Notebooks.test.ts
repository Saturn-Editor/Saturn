import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_STYLE, isPageFile } from '@shared/notebooks';
import { NotebookStore } from '../../../src/main/Notebooks/NotebookStore';
import { isNotebookFolder, readNotebookMeta } from '../../../src/main/Notebooks/Notebook';

let data: string;
let store: NotebookStore;

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'saturn-nb-'));
  store = new NotebookStore(join(data, 'notebooks.json'), join(data, 'notebook-settings.json'), join(data, 'notebooks'));
});

describe('notebooks', () => {
  it('creates a notebook with a first page and lists it', async () => {
    const path = await store.create('Ideas');
    expect(isNotebookFolder(path)).toBe(true);
    expect((await readNotebookMeta(path)).name).toBe('Ideas');
    expect(isPageFile(JSON.parse(readFileSync(join(path, 'Untitled.snp'), 'utf8')))).toBe(true);
    expect((await store.list()).map((n) => n.name)).toEqual(['Ideas']);
  });

  it('gives a second notebook with the same name a free folder', async () => {
    const a = await store.create('Ideas');
    const b = await store.create('Ideas');
    expect(b).not.toBe(a);
    expect(b.endsWith('Ideas 2')).toBe(true);
  });

  it('refuses an empty name', async () => {
    await expect(store.create('  ')).rejects.toThrow('Give the notebook a name');
  });

  it('remembers the folder setting and the default page style separately', async () => {
    expect((await store.folder()).isDefault).toBe(true);
    await store.setStyle({ font: 'serif', background: '#ffffff', text: null });
    const other = join(data, 'elsewhere');
    await store.setFolder(other);
    expect(await store.folder()).toEqual({ path: other, isDefault: false });
    expect((await store.style()).font).toBe('serif');
    await store.setFolder(null);
    expect((await store.style()).font).toBe('serif');
    await expect(store.setStyle({ font: 'comic' as never, background: null, text: null })).rejects.toThrow();
    expect(DEFAULT_PAGE_STYLE.font).toBe('theme');
  });

  it('moves notebooks to a new folder, skipping open ones', async () => {
    const keep = await store.create('Open one');
    const move = await store.create('Moving');
    const oldFolder = (await store.folder()).path;
    await store.setFolder(join(data, 'new'));
    const result = await store.moveFrom(oldFolder, (p) => p === keep);
    expect(result).toEqual({ moved: 1, skipped: ['Open one'] });
    expect(existsSync(move)).toBe(false);
    expect(existsSync(join(data, 'new', 'Moving', 'notebook.json'))).toBe(true);
    expect((await store.list()).find((n) => n.name === 'Moving')?.path).toBe(join(data, 'new', 'Moving'));
  });
});
