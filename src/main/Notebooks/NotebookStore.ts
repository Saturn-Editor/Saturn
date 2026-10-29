import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { DEFAULT_PAGE_STYLE, isPageStyle, type NotebookFolder, type NotebookSummary, type PageStyle } from '@shared/notebooks';
import { FileStore } from '../Store/FileStore';
import { createNotebook, isNotebookFolder, readNotebookMeta } from './Notebook';

type Stored = Omit<NotebookSummary, 'missing'>;

function isStoredList(v: unknown): v is Stored[] {
  return Array.isArray(v) && v.every((n) => typeof n?.path === 'string' && typeof n?.name === 'string' && typeof n?.openedAt === 'number');
}

function key(path: string): string {
  const full = resolve(path);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

export class NotebookStore {
  private readonly store: FileStore<Stored[]>;
  private readonly settings: FileStore<{ folder?: string; style?: PageStyle }>;

  constructor(file: string, settingsFile: string, private readonly defaultDir: string) {
    this.store = new FileStore(file, [], isStoredList);
    this.settings = new FileStore(settingsFile, {}, (v): v is { folder?: string; style?: PageStyle } => typeof v === 'object' && v !== null);
  }

  async style(): Promise<PageStyle> {
    const { style } = await this.settings.read();
    return style && isPageStyle(style) ? style : DEFAULT_PAGE_STYLE;
  }

  async setStyle(style: PageStyle): Promise<PageStyle> {
    if (!isPageStyle(style)) throw new Error('Invalid page style');
    await this.settings.update((s) => ({ ...s, style }));
    return style;
  }

  async folder(): Promise<NotebookFolder> {
    const { folder } = await this.settings.read();
    return folder ? { path: folder, isDefault: false } : { path: this.defaultDir, isDefault: true };
  }

  async setFolder(folder: string | null): Promise<NotebookFolder> {
    await this.settings.update(({ style }) => ({ style, ...(folder ? { folder: resolve(folder) } : {}) }));
    return this.folder();
  }

  async list(): Promise<NotebookSummary[]> {
    const stored = await this.store.read();
    return Promise.all(stored.map(async (n) => ({ ...n, missing: !(await stat(n.path).then((s) => s.isDirectory(), () => false)) })));
  }

  async create(name: string): Promise<string> {
    const title = name.trim();
    if (!title) throw new Error('Give the notebook a name');
    const base = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    const dir = (await this.folder()).path;
    let path = join(dir, base);
    for (let n = 2; isNotebookFolder(path) || (await stat(path).then(() => true, () => false)); n++) path = join(dir, `${base} ${n}`);
    await createNotebook(path, title);
    await this.touch(path, title);
    return path;
  }

  async add(path: string): Promise<void> {
    const meta = await readNotebookMeta(path);
    await this.touch(path, meta.name);
  }

  async touch(path: string, name: string): Promise<void> {
    const full = resolve(path);
    await this.store.update((list) => [{ path: full, name, openedAt: Date.now() }, ...list.filter((n) => key(n.path) !== key(full))]);
  }

  async inFolder(folder: string): Promise<NotebookSummary[]> {
    return (await this.list()).filter((n) => !n.missing && key(dirname(n.path)) === key(folder));
  }

  async moveFrom(folder: string, isOpen: (path: string) => boolean): Promise<{ moved: number; skipped: string[] }> {
    const target = (await this.folder()).path;
    if (key(target) === key(folder)) return { moved: 0, skipped: [] };
    await mkdir(target, { recursive: true });
    let moved = 0;
    const skipped: string[] = [];
    for (const notebook of await this.inFolder(folder)) {
      if (isOpen(notebook.path)) {
        skipped.push(notebook.name);
        continue;
      }
      let to = join(target, basename(notebook.path));
      for (let n = 2; await stat(to).then(() => true, () => false); n++) to = join(target, `${basename(notebook.path)} ${n}`);
      try {
        await rename(notebook.path, to);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
        await cp(notebook.path, to, { recursive: true, preserveTimestamps: true });
        await rm(notebook.path, { recursive: true, force: true });
      }
      await this.store.update((list) => list.map((n) => (key(n.path) === key(notebook.path) ? { ...n, path: to } : n)));
      moved++;
    }
    return { moved, skipped };
  }

  async remove(path: string): Promise<void> {
    await this.store.update((list) => list.filter((n) => key(n.path) !== key(path)));
  }

  async known(path: string): Promise<boolean> {
    return (await this.store.read()).some((n) => key(n.path) === key(path));
  }
}
