export const NOTEBOOK_FORMAT = 'saturn-notebook';
export const PAGE_FORMAT = 'saturn-notebook-page';
export const NOTEBOOK_VERSION = 1;
export const NOTEBOOK_FILE = 'notebook.json';
export const PAGE_EXTENSION = '.snp';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface NotebookSummary {
  path: string;
  name: string;
  openedAt: number;
  missing: boolean;
}

export type PageFont = 'theme' | 'sans' | 'serif' | 'mono' | 'dyslexic';

export const PAGE_FONTS: { id: PageFont; label: string }[] = [
  { id: 'theme', label: 'Theme font' },
  { id: 'sans', label: 'Sans-serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Monospaced' },
  { id: 'dyslexic', label: 'OpenDyslexic' },
];

export interface PageStyle {
  font: PageFont;
  background: string | null;
  text: string | null;
}

export const DEFAULT_PAGE_STYLE: PageStyle = { font: 'theme', background: null, text: null };

export function isPageStyle(v: unknown): v is PageStyle {
  const s = v as PageStyle;
  const colour = (c: unknown) => c === null || (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
  return typeof s === 'object' && s !== null && PAGE_FONTS.some((f) => f.id === s.font) && colour(s.background) && colour(s.text);
}

export interface NotebookMeta {
  format: typeof NOTEBOOK_FORMAT;
  version: number;
  name: string;
}

export interface PageFile {
  format: typeof PAGE_FORMAT;
  version: number;
  font?: PageFont;
  background?: string | null;
  text?: string | null;
  doc: unknown;
}

export interface NotebookFolder {
  path: string;
  isDefault: boolean;
}

export function emptyPage(): PageFile {
  return { format: PAGE_FORMAT, version: NOTEBOOK_VERSION, doc: { type: 'doc', content: [{ type: 'paragraph' }] } };
}

export function isPageFile(v: unknown): v is PageFile {
  const p = v as PageFile;
  return typeof p === 'object' && p !== null && p.format === PAGE_FORMAT && typeof p.version === 'number' && typeof p.doc === 'object';
}
