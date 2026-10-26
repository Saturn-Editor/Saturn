import { watch, type FSWatcher } from 'node:fs';
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { DirEntry, FileReadResult } from '@shared/types';

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const SNIFF_BYTES = 8 * 1024;
const HIDDEN = new Set(['.git']);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** File access for one project. Every path must stay inside the project root. */
export class FileService {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async readDir(dir: string): Promise<DirEntry[]> {
    const full = this.inside(dir);
    const entries = await readdir(full, { withFileTypes: true });
    return entries
      .filter((e) => !HIDDEN.has(e.name))
      .map((e): DirEntry => ({ name: e.name, path: join(full, e.name), kind: e.isDirectory() ? 'dir' : 'file' }))
      .sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1));
  }

  async readFile(path: string, opts: { force?: boolean } = {}): Promise<FileReadResult> {
    const full = this.inside(path);
    const { size } = await stat(full);
    if (await this.looksBinary(full)) return { kind: 'binary' };
    if (size > MAX_TEXT_BYTES && !opts.force) return { kind: 'too-large', bytes: size };
    const text = await readFile(full, 'utf8');
    const firstBreak = text.indexOf('\n');
    const eol = firstBreak > 0 && text[firstBreak - 1] === '\r' ? 'CRLF' : 'LF';
    return { kind: 'text', text, eol };
  }

  async writeFile(path: string, text: string): Promise<void> {
    await writeFile(this.inside(path), text, 'utf8');
  }

  /** Creates a new file; never overwrites an existing file or folder. */
  async createFile(path: string, text = ''): Promise<void> {
    const full = this.inside(path);
    await this.assertFree(full);
    await writeFile(full, text, { encoding: 'utf8', flag: 'wx' });
  }

  async createDir(path: string): Promise<void> {
    const full = this.inside(path);
    await this.assertFree(full);
    await mkdir(full);
  }

  private async assertFree(full: string): Promise<void> {
    const exists = await stat(full).then(() => true, () => false);
    if (exists) throw new Error(`A file or folder named ${basename(full)} already exists`);
  }

  /** Watches the project and reports the folder that changed (debounced per folder). */
  watch(onChange: (dir: string) => void): () => void {
    const pending = new Map<string, NodeJS.Timeout>();
    const report = (file: string | null) => {
      const dir = file ? dirname(join(this.root, file)) : this.root;
      clearTimeout(pending.get(dir));
      pending.set(dir, setTimeout(() => { pending.delete(dir); onChange(dir); }, 150));
    };
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(this.root, { recursive: true }, (_event, file) => report(file ? String(file) : null));
    } catch {
      // Recursive watching isn't supported everywhere (older Linux); fall back to the root only.
      watcher = watch(this.root, (_event, file) => report(file ? String(file) : null));
    }
    watcher.on('error', () => undefined);
    return () => {
      watcher?.close();
      pending.forEach(clearTimeout);
    };
  }

  private inside(path: string): string {
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside the project');
    return full;
  }

  private async looksBinary(path: string): Promise<boolean> {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
      return buffer.subarray(0, bytesRead).includes(0);
    } finally {
      await handle.close();
    }
  }
}
