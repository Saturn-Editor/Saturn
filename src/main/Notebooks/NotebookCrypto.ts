import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { safeStorage } from 'electron';
import {
  NOTEBOOK_FILE, NOTEBOOK_VERSION, PAGE_EXTENSION, PAGE_LINK, emptyPage, isPageFile, newPageId,
  type EncryptedPageFile, type NotebookEncryption, type NotebookKdf, type NotebookLock, type PageFile, type Sealed,
} from '@shared/notebooks';
import { PROJECT_FOLDER } from '@shared/types';
import type { FileStore } from '../Store/FileStore';
import { readNotebookMeta } from './Notebook';

const ARGON2 = { memory: 131072, passes: 3, parallelism: 4 };
const MIN_PASSWORD = 8;

async function deriveKey(password: string, k: NotebookKdf): Promise<Buffer> {
  if (k.kdf !== 'argon2id') throw new Error('This notebook uses an unsupported key derivation');
  const key = await argon2id({
    password: Buffer.from(password.normalize('NFKC'), 'utf8'),
    salt: Buffer.from(k.salt, 'base64'),
    memorySize: k.memory,
    iterations: k.passes,
    parallelism: k.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
  return Buffer.from(key);
}

function newKdf(): NotebookKdf {
  return { kdf: 'argon2id', salt: randomBytes(16).toString('base64'), ...ARGON2 };
}

function seal(key: Buffer, plain: Buffer, context: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(key: Buffer, sealed: Sealed, context: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
}

function withoutFormat(page: PageFile): PageFile {
  const { format: _, ...rest } = page as PageFile & { format?: unknown };
  return rest;
}

function isEncryptedPage(v: unknown): v is EncryptedPageFile {
  const p = v as EncryptedPageFile;
  return typeof p === 'object' && p !== null && typeof p.encrypted?.data === 'string';
}

async function pagesIn(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await pagesIn(full));
    else if (entry.name.toLowerCase().endsWith(PAGE_EXTENSION)) found.push(full);
  }
  return found;
}

export interface KeySource {
  read(root: string): Promise<NotebookEncryption | undefined>;
  write(root: string, encryption: NotebookEncryption | undefined): Promise<void>;
}

const notebookSource: KeySource = {
  read: async (root) => (await readNotebookMeta(root)).encryption,
  write: async (root, encryption) => {
    const { encryption: _, ...meta } = await readNotebookMeta(root);
    await writeFile(join(root, NOTEBOOK_FILE), JSON.stringify(encryption ? { ...meta, encryption } : meta, null, 2));
  },
};

const projectSource: KeySource = {
  read: async (root) => {
    const text = await readFile(join(root, PROJECT_FOLDER, 'encryption.json'), 'utf8').catch(() => null);
    return text ? (JSON.parse(text) as NotebookEncryption) : undefined;
  },
  write: async (root, encryption) => {
    const file = join(root, PROJECT_FOLDER, 'encryption.json');
    if (!encryption) return void (await rm(file, { force: true }));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(encryption, null, 2));
  },
};

export class NotebookCrypto {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    private readonly remembered: FileStore<Record<string, string>>,
    private readonly source: KeySource = notebookSource,
    private readonly onChange: (root: string, state: NotebookLock) => void = () => undefined,
    private readonly beforeRemove: (root: string) => Promise<void> = async () => undefined,
  ) {}

  forProjectType(onChange: (root: string, state: NotebookLock) => void, beforeRemove: (root: string) => Promise<void>): NotebookCrypto {
    return new NotebookCrypto(this.remembered, projectSource, onChange, beforeRemove);
  }

  async state(root: string): Promise<NotebookLock> {
    if (!(await this.source.read(root))) return 'none';
    if (this.keys.has(root)) return 'unlocked';
    return (await this.recall(root)) ? 'unlocked' : 'locked';
  }

  async unlock(root: string, password: string, remember: boolean): Promise<void> {
    const encryption = await this.source.read(root);
    if (!encryption) return;
    const kek = await deriveKey(password, encryption);
    let key: Buffer;
    try {
      key = open(kek, encryption.key, 'notebook-key');
    } catch {
      throw new Error('Wrong password');
    } finally {
      kek.fill(0);
    }
    this.keys.set(root, key);
    if (remember) await this.remember(root, key);
    this.onChange(root, 'unlocked');
  }

  async lock(root: string): Promise<void> {
    this.keys.get(root)?.fill(0);
    this.keys.delete(root);
    await this.forget(root);
    this.onChange(root, (await this.source.read(root)) ? 'locked' : 'none');
  }

  async enable(root: string, password: string, remember: boolean): Promise<void> {
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    if (await this.source.read(root)) throw new Error('This notebook is already encrypted');
    const key = randomBytes(32);
    const encryption = await this.wrap(key, password);
    for (const path of await pagesIn(root)) {
      await writeFile(path, this.encode(this.decode(await readFile(path, 'utf8'), null), key));
    }
    await this.source.write(root, encryption);
    this.keys.set(root, key);
    if (remember) await this.remember(root, key);
  }

  async disable(root: string, password: string): Promise<void> {
    if (!(await this.source.read(root))) return;
    await this.unlock(root, password, false);
    const key = this.keys.get(root);
    if (!key) throw new Error('Wrong password');
    for (const path of await pagesIn(root)) {
      await writeFile(path, JSON.stringify(this.decode(await readFile(path, 'utf8'), key)));
    }
    await this.source.write(root, undefined);
    await this.lock(root);
  }

  async enableKeyOnly(root: string, password: string, remember: boolean): Promise<void> {
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    if (await this.source.read(root)) throw new Error('This project is already encrypted');
    const key = randomBytes(32);
    await this.source.write(root, await this.wrap(key, password));
    this.keys.set(root, key);
    if (remember) await this.remember(root, key);
    this.onChange(root, 'unlocked');
  }

  async disableKeyOnly(root: string, password: string): Promise<void> {
    if (!(await this.source.read(root))) return;
    await this.unlock(root, password, false);
    await this.beforeRemove(root);
    await this.source.write(root, undefined);
    await this.lock(root);
  }

  async encryptText(root: string, text: string): Promise<string> {
    const key = await this.projectKey(root);
    return JSON.stringify(seal(key, Buffer.from(text, 'utf8'), 'value'));
  }

  async decryptText(root: string, text: string): Promise<string> {
    const key = await this.projectKey(root);
    return open(key, JSON.parse(text) as Sealed, 'value').toString('utf8');
  }

  async changePassword(root: string, current: string, next: string): Promise<void> {
    if (next.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    await this.unlock(root, current, false);
    await this.source.write(root, await this.wrap(this.keys.get(root)!, next));
  }

  async readPage(root: string, path: string): Promise<PageFile> {
    const full = this.inside(root, path);
    const key = (await this.source.read(root)) ? await this.keyFor(root) : null;
    return this.decode(await readFile(full, 'utf8'), key);
  }

  async writePage(root: string, path: string, page: PageFile): Promise<void> {
    const full = this.inside(root, path);
    if (!isPageFile(page)) throw new Error("That isn't a Saturn notebook page");
    const key = (await this.source.read(root)) ? await this.keyFor(root) : null;
    await writeFile(full, key ? this.encode(page, key) : JSON.stringify(page));
  }

  private async projectKey(root: string): Promise<Buffer> {
    if (!(await this.source.read(root))) throw new Error("This project isn't encrypted");
    const key = this.keys.get(root) ?? await this.recall(root);
    if (!key) throw new Error('This project is locked');
    return key;
  }

  async titles(root: string): Promise<Record<string, string>> {
    const read = async () => {
      const pages: { path: string; page: PageFile }[] = [];
      for (const path of await pagesIn(root)) {
        const page = await this.readPage(root, path).catch(() => null);
        if (page) pages.push({ path, page });
      }
      return pages;
    };
    let pages = await read();
    if (pages.some((p) => p.page.title === undefined)) {
      await this.convertOldPages(root, pages);
      pages = await read();
    }
    return Object.fromEntries(pages.map((p) => [p.path, p.page.title?.trim() || 'Untitled']));
  }

  private async convertOldPages(root: string, pages: { path: string; page: PageFile }[]): Promise<void> {
    const rel = (p: string) => relative(root, p).split(sep).join('/');
    const old = pages.filter((p) => p.page.title === undefined);
    const plan = old.map((p) => ({ path: p.path, id: newPageId(), title: basename(p.path).replace(/\.snp$/i, '') }));
    const idByOldLink = new Map(pages.map((p) => [rel(p.path), p.page.title === undefined ? '' : basename(p.path).replace(/\.snp$/i, '')]));
    for (const step of plan) idByOldLink.set(rel(step.path), step.id);
    const depth = (p: string) => p.split(sep).length;
    for (const step of [...plan].sort((a, b) => depth(b.path) - depth(a.path))) {
      const dir = dirname(step.path);
      await rename(step.path, join(dir, `${step.id}${PAGE_EXTENSION}`));
      const folder = join(dir, step.title);
      if (await stat(folder).then((s) => s.isDirectory(), () => false)) await rename(folder, join(dir, step.id));
    }
    const titleById = new Map(plan.map((s) => [s.id, s.title]));
    const relink = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(relink);
      if (typeof node !== 'object' || node === null) return;
      const n = node as { type?: string; attrs?: { href?: unknown } };
      if (n.type === 'link' && typeof n.attrs?.href === 'string' && n.attrs.href.startsWith(PAGE_LINK)) {
        const id = idByOldLink.get(n.attrs.href.slice(PAGE_LINK.length));
        if (id) n.attrs.href = `${PAGE_LINK}${id}`;
      }
      Object.values(node).forEach(relink);
    };
    for (const path of await pagesIn(root)) {
      const page = await this.readPage(root, path);
      const id = basename(path).replace(/\.snp$/i, '');
      relink(page.doc);
      await this.writePage(root, path, { ...page, title: page.title ?? titleById.get(id) ?? 'Untitled' });
    }
  }

  async createPage(root: string, dir: string, title: string): Promise<string> {
    const path = this.inside(root, join(dir, `${newPageId()}${PAGE_EXTENSION}`));
    await mkdir(dirname(path), { recursive: true });
    await this.writePage(root, path, emptyPage(title.trim() || 'Untitled'));
    return path;
  }

  async setTitle(root: string, path: string, title: string): Promise<void> {
    const page = await this.readPage(root, path);
    await this.writePage(root, path, { ...page, title: title.trim() || 'Untitled' });
  }

  private async keyFor(root: string): Promise<Buffer> {
    const key = this.keys.get(root) ?? await this.recall(root);
    if (!key) throw new Error('This notebook is locked');
    return key;
  }

  private async wrap(key: Buffer, password: string): Promise<NotebookEncryption> {
    const params = newKdf();
    const kek = await deriveKey(password, params);
    try {
      return { ...params, key: seal(kek, key, 'notebook-key') };
    } finally {
      kek.fill(0);
    }
  }

  private encode(page: PageFile, key: Buffer): string {
    const file: EncryptedPageFile = {
      version: NOTEBOOK_VERSION,
      encrypted: seal(key, Buffer.from(JSON.stringify(page), 'utf8'), 'page'),
    };
    return JSON.stringify(file);
  }

  private decode(text: string, key: Buffer | null): PageFile {
    const parsed: unknown = text.trim() ? JSON.parse(text) : null;
    if (parsed === null) return emptyPage();
    if (isEncryptedPage(parsed)) {
      if (!key) throw new Error('This page is encrypted');
      const page: unknown = JSON.parse(open(key, parsed.encrypted, 'page').toString('utf8'));
      if (!isPageFile(page)) throw new Error("This file isn't a Saturn notebook page");
      return withoutFormat(page);
    }
    if (!isPageFile(parsed)) throw new Error("This file isn't a Saturn notebook page");
    return withoutFormat(parsed);
  }

  private inside(root: string, path: string): string {
    const full = resolve(root, path);
    if (!full.startsWith(resolve(root) + sep) || !full.toLowerCase().endsWith(PAGE_EXTENSION)) throw new Error('That page is outside this notebook');
    return full;
  }

  private async remember(root: string, key: Buffer): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This device can't store the key securely; unlock with your password each time");
    const sealed = safeStorage.encryptString(key.toString('base64')).toString('base64');
    await this.remembered.update((all) => ({ ...all, [root]: sealed }));
  }

  private async forget(root: string): Promise<void> {
    await this.remembered.update(({ [root]: _, ...rest }) => rest);
  }

  private async recall(root: string): Promise<Buffer | null> {
    const stored = (await this.remembered.read())[root];
    if (!stored || !safeStorage.isEncryptionAvailable()) return null;
    try {
      const key = Buffer.from(safeStorage.decryptString(Buffer.from(stored, 'base64')), 'base64');
      if (key.length !== 32) return null;
      this.keys.set(root, key);
      return key;
    } catch {
      return null;
    }
  }
}
