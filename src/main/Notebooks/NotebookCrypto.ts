import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { safeStorage } from 'electron';
import {
  NOTEBOOK_FILE, NOTEBOOK_VERSION, PAGE_EXTENSION, PAGE_LINK, emptyPage, isPageFile, newPageId,
  type EncryptedPageFile, type NotebookEncryption, type NotebookKdf, type NotebookLock, type NotebookMeta, type PageFile, type Sealed,
} from '@shared/notebooks';
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

export class NotebookCrypto {
  private readonly keys = new Map<string, Buffer>();

  constructor(private readonly remembered: FileStore<Record<string, string>>) {}

  async state(root: string): Promise<NotebookLock> {
    const meta = await readNotebookMeta(root);
    if (!meta.encryption) return 'none';
    if (this.keys.has(root)) return 'unlocked';
    return (await this.recall(root)) ? 'unlocked' : 'locked';
  }

  async unlock(root: string, password: string, remember: boolean): Promise<void> {
    const meta = await readNotebookMeta(root);
    if (!meta.encryption) return;
    const kek = await deriveKey(password, meta.encryption);
    let key: Buffer;
    try {
      key = open(kek, meta.encryption.key, 'notebook-key');
    } catch {
      throw new Error('Wrong password');
    } finally {
      kek.fill(0);
    }
    this.keys.set(root, key);
    if (remember) await this.remember(root, key);
  }

  async lock(root: string): Promise<void> {
    this.keys.get(root)?.fill(0);
    this.keys.delete(root);
    await this.forget(root);
  }

  async enable(root: string, password: string, remember: boolean): Promise<void> {
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    const meta = await readNotebookMeta(root);
    if (meta.encryption) throw new Error('This notebook is already encrypted');
    const key = randomBytes(32);
    const encryption = await this.wrap(key, password);
    for (const path of await pagesIn(root)) {
      await writeFile(path, this.encode(this.decode(await readFile(path, 'utf8'), null), key));
    }
    await this.writeMeta(root, { ...meta, encryption });
    this.keys.set(root, key);
    if (remember) await this.remember(root, key);
  }

  async disable(root: string, password: string): Promise<void> {
    const meta = await readNotebookMeta(root);
    if (!meta.encryption) return;
    await this.unlock(root, password, false);
    const key = this.keys.get(root);
    if (!key) throw new Error('Wrong password');
    for (const path of await pagesIn(root)) {
      await writeFile(path, JSON.stringify(this.decode(await readFile(path, 'utf8'), key)));
    }
    const { encryption: _, ...plain } = meta;
    await this.writeMeta(root, plain);
    await this.lock(root);
  }

  async changePassword(root: string, current: string, next: string): Promise<void> {
    if (next.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    await this.unlock(root, current, false);
    const meta = await readNotebookMeta(root);
    await this.writeMeta(root, { ...meta, encryption: await this.wrap(this.keys.get(root)!, next) });
  }

  async readPage(root: string, path: string): Promise<PageFile> {
    const full = this.inside(root, path);
    const meta = await readNotebookMeta(root);
    const key = meta.encryption ? await this.keyFor(root) : null;
    return this.decode(await readFile(full, 'utf8'), key);
  }

  async writePage(root: string, path: string, page: PageFile): Promise<void> {
    const full = this.inside(root, path);
    if (!isPageFile(page)) throw new Error("That isn't a Saturn notebook page");
    const meta = await readNotebookMeta(root);
    const key = meta.encryption ? await this.keyFor(root) : null;
    await writeFile(full, key ? this.encode(page, key) : JSON.stringify(page));
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

  private async writeMeta(root: string, meta: NotebookMeta): Promise<void> {
    await writeFile(join(root, NOTEBOOK_FILE), JSON.stringify(meta, null, 2));
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
