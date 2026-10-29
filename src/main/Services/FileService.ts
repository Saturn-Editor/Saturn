import { watch, type FSWatcher } from 'node:fs';
import { cp, mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DirEntry, FileEncoding, FileReadResult } from '@shared/types';

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const SNIFF_BYTES = 8 * 1024;
const HIDDEN = new Set(['.git']);
const NODE_ENCODINGS: Record<FileEncoding, BufferEncoding> = { 'utf-8': 'utf8', 'utf-16': 'utf16le', 'us-ascii': 'ascii', 'iso-8859-1': 'latin1' };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** File access for one project. Every path must stay inside the project root. */
export class FileService {
  private readonly root: string;

  /** `encoding` is read on every read and save, so Settings → Editor → Encoding applies straight away. */
  constructor(root: string, private readonly encoding: () => Promise<FileEncoding> = async () => 'utf-8') {
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
    const encoding = await this.encoding();
    const head = await this.head(full);
    // A UTF-16 byte-order mark means UTF-16 whatever the setting; such files are full of zero bytes, so skip the binary check.
    const utf16 = encoding === 'utf-16' || (head[0] === 0xff && head[1] === 0xfe);
    if (!utf16 && head.includes(0)) return { kind: 'binary' };
    if (size > MAX_TEXT_BYTES && !opts.force) return { kind: 'too-large', bytes: size };
    const bytes = await readFile(full);
    const text = utf16 ? bytes.toString('utf16le').replace(/^﻿/, '') : bytes.toString(NODE_ENCODINGS[encoding]).replace(/^﻿/, '');
    const firstBreak = text.indexOf('\n');
    const eol = firstBreak > 0 && text[firstBreak - 1] === '\r' ? 'CRLF' : 'LF';
    return { kind: 'text', text, eol };
  }

  /** Saves in the chosen encoding; UTF-16 is written little-endian with a byte-order mark. */
  async writeFile(path: string, text: string): Promise<void> {
    const encoding = await this.encoding();
    const data = encoding === 'utf-16' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) : Buffer.from(text, NODE_ENCODINGS[encoding]);
    await writeFile(this.inside(path), data);
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

  /** Renames a file or folder in place; returns its new path. The project folder itself can't be renamed. */
  async rename(path: string, newName: string): Promise<string> {
    const full = this.entry(path);
    const name = newName.trim();
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('Enter a name without slashes');
    const target = join(dirname(full), name);
    if (target === full) return full;
    // A case-only rename is the same entry on case-insensitive disks, so it isn't "already existing".
    if (target.toLowerCase() !== full.toLowerCase()) await this.assertFree(target);
    await rename(full, target);
    return target;
  }

  async move(path: string, toDir: string): Promise<string> {
    const full = this.entry(path);
    const dir = this.inside(toDir);
    const target = join(dir, basename(full));
    if (target === full) return full;
    if (dir === full || dir.startsWith(full + sep)) throw new Error("A folder can't be moved into itself");
    await this.assertFree(target);
    await rename(full, target);
    return target;
  }

  async copy(path: string, toDir: string): Promise<string> {
    const full = this.entry(path);
    const dir = this.inside(toDir);
    if (dir === full || dir.startsWith(full + sep)) throw new Error("A folder can't be copied into itself");
    const target = await this.freeName(dir, basename(full));
    await cp(full, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    return target;
  }

  private async freeName(dir: string, name: string): Promise<string> {
    const exists = (p: string) => stat(p).then(() => true, () => false);
    if (!(await exists(join(dir, name)))) return join(dir, name);
    const ext = extname(name);
    const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
    const suffix = ext && ext !== name ? ext : '';
    for (let n = 1; ; n++) {
      const candidate = join(dir, `${stem} copy${n > 1 ? ` ${n}` : ''}${suffix}`);
      if (!(await exists(candidate))) return candidate;
    }
  }

  /** The full path of a file or folder inside the project, for actions such as Delete; never the project folder itself. */
  entry(path: string): string {
    const full = this.inside(path);
    if (full === this.root) throw new Error("That's the project folder");
    return full;
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

  /** The first few KB of a file, for the encoding and binary checks. */
  private async head(path: string): Promise<Buffer> {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
