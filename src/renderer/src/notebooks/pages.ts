import { MAX_IMAGE_BYTES, PAGE_EXTENSION, PAGE_LINK, pageId } from '@shared/notebooks';
import { baseName, parentOf } from '@renderer/helpers';

export { PAGE_LINK, pageId } from '@shared/notebooks';

export interface PageRef {
  path: string;
  title: string;
}

export function isPagePath(path: string): boolean {
  return path.toLowerCase().endsWith(PAGE_EXTENSION);
}

export function pageLink(path: string): string {
  return `${PAGE_LINK}${pageId(path)}`;
}

export function pageForLink(href: string, titles: Record<string, string>): string | undefined {
  const id = href.slice(PAGE_LINK.length);
  return Object.keys(titles).find((p) => pageId(p) === id);
}

export function subpageFolder(pagePath: string): string {
  return `${parentOf(pagePath)}/${pageId(pagePath)}`;
}

async function exists(path: string): Promise<boolean> {
  const dir = parentOf(path);
  const name = baseName(path).toLowerCase();
  return (await window.saturn.fs.readDir(dir).catch(() => [])).some((e) => e.name.toLowerCase() === name);
}

export async function createPage(dir: string, title = 'Untitled'): Promise<PageRef> {
  const path = await window.saturn.notebooks.createPage(dir, title);
  return { path, title: title.trim() || 'Untitled' };
}

export function createSubpage(pagePath: string): Promise<PageRef> {
  return createPage(subpageFolder(pagePath));
}

export async function hasSubpages(pagePath: string): Promise<boolean> {
  return exists(subpageFolder(pagePath));
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
