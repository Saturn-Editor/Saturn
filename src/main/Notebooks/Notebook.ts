import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyPage, NOTEBOOK_FILE, NOTEBOOK_FORMAT, NOTEBOOK_VERSION, PAGE_EXTENSION, type NotebookMeta } from '@shared/notebooks';

export function isNotebookMeta(v: unknown): v is NotebookMeta {
  const m = v as NotebookMeta;
  return typeof m === 'object' && m !== null && m.format === NOTEBOOK_FORMAT && typeof m.name === 'string';
}

export function isNotebookFolder(dir: string): boolean {
  return existsSync(join(dir, NOTEBOOK_FILE));
}

export async function createNotebook(root: string, name: string): Promise<void> {
  if (isNotebookFolder(root)) throw new Error('That folder already holds a notebook');
  await mkdir(root, { recursive: true });
  const meta: NotebookMeta = { format: NOTEBOOK_FORMAT, version: NOTEBOOK_VERSION, name };
  await writeFile(join(root, NOTEBOOK_FILE), JSON.stringify(meta, null, 2));
  await writeFile(join(root, `Untitled${PAGE_EXTENSION}`), JSON.stringify(emptyPage()));
}

export async function readNotebookMeta(root: string): Promise<NotebookMeta> {
  const parsed: unknown = JSON.parse(await readFile(join(root, NOTEBOOK_FILE), 'utf8'));
  if (!isNotebookMeta(parsed)) throw new Error("This folder's notebook.json isn't a Saturn notebook");
  if (parsed.version > NOTEBOOK_VERSION) throw new Error('This notebook was made by a newer Saturn; update Saturn to open it');
  return parsed;
}
