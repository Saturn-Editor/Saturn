import { emptyPage, MAX_IMAGE_BYTES, PAGE_EXTENSION } from '@shared/notebooks';
import { baseName, parentOf } from '@renderer/helpers';

export const PAGE_LINK = 'saturn-page:';

export interface PageRef {
  path: string;
  title: string;
}

export function pageTitle(path: string): string {
  return baseName(path).replace(/\.snp$/i, '');
}

export function isPagePath(path: string): boolean {
  return path.toLowerCase().endsWith(PAGE_EXTENSION);
}

export async function listPages(root: string): Promise<PageRef[]> {
  const found: PageRef[] = [];
  const walk = async (dir: string) => {
    for (const entry of await window.saturn.fs.readDir(dir).catch(() => [])) {
      if (entry.kind === 'dir') await walk(entry.path);
      else if (isPagePath(entry.path)) found.push({ path: entry.path, title: pageTitle(entry.path) });
    }
  };
  await walk(root);
  return found;
}

export function subpageFolder(pagePath: string): string {
  return `${parentOf(pagePath)}/${pageTitle(pagePath)}`;
}

async function exists(path: string): Promise<boolean> {
  const dir = parentOf(path);
  const name = baseName(path).toLowerCase();
  return (await window.saturn.fs.readDir(dir).catch(() => [])).some((e) => e.name.toLowerCase() === name);
}

export function cleanTitle(title: string): string {
  return title.trim().replace(/[\\/:*?"<>|]/g, '-') || 'Untitled';
}

export async function freeTitle(dir: string, title: string, except?: string): Promise<string> {
  const base = cleanTitle(title);
  for (let n = 1; n < 500; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    const path = `${dir}/${candidate}${PAGE_EXTENSION}`;
    if (path === except || (!(await exists(path)) && !(await exists(`${dir}/${candidate}`)))) return candidate;
  }
  throw new Error(`Too many pages named ${base}`);
}

export async function createPage(dir: string, title = 'Untitled'): Promise<PageRef> {
  await window.saturn.fs.createDir(dir).catch(() => undefined);
  const free = await freeTitle(dir, title);
  const path = `${dir}/${free}${PAGE_EXTENSION}`;
  await window.saturn.fs.createFile(path, JSON.stringify(emptyPage()));
  return { path, title: free };
}

export function createSubpage(pagePath: string): Promise<PageRef> {
  return createPage(subpageFolder(pagePath));
}

export async function hasSubpages(pagePath: string): Promise<boolean> {
  return exists(subpageFolder(pagePath));
}

export async function renamePage(pagePath: string, title: string): Promise<string> {
  const dir = parentOf(pagePath);
  const free = await freeTitle(dir, title, pagePath);
  if (free === pageTitle(pagePath)) return pagePath;
  const folder = await hasSubpages(pagePath);
  const to = await window.saturn.fs.rename(pagePath, `${free}${PAGE_EXTENSION}`);
  if (folder) await window.saturn.fs.rename(subpageFolder(pagePath), free);
  return to;
}

export function imageAsDataUrl(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) return Promise.reject(new Error(`${file.name} is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
