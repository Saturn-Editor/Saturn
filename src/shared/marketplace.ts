import { SATURN_API_VERSION, satisfiesCaret } from './modules';

/** The marketplace index, hosted in the Saturn-Editor/Marketplace repo. */
export const MARKETPLACE_INDEX_URL = 'https://raw.githubusercontent.com/Saturn-Editor/Marketplace/refs/heads/main/index.json';

/** The index `schema` this build understands; any other is rejected. */
export const MARKETPLACE_SCHEMA = 2;

export type MarketplaceKind = 'languages' | 'themes' | 'extensions';

/**
 * index.json: where each kind's list lives, relative to index.json (e.g. "languages.json"). Lists are
 * fetched separately, when their Marketplace section is opened, so the index stays small as it grows.
 */
export interface MarketplaceIndex {
  schema: number;
  languages: string;
  themes: string;
  extensions: string;
}

/** One published release. Themes have no `saturnApi`. */
export interface MarketplaceVersion {
  version: string;
  /** Caret range of the Saturn module API it needs, e.g. "^0.2". */
  saturnApi?: string;
  /** GitHub Release zip URL. */
  download: string;
  sha256: string;
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  /** Source repo as "owner/name". */
  repo: string;
  /** A picture for the Marketplace (https URL). */
  image?: string;
  /** Languages and extensions: pre-selected in the first-launch welcome popup. */
  default?: boolean;
  /** Releases, newest first. */
  versions: MarketplaceVersion[];
}

/** What a Saturn of this API version can do with an entry. */
export interface VersionChoice {
  /** The newest release this Saturn can install, if any. */
  installable: MarketplaceVersion | null;
  /** The newest release overall (may need a newer Saturn). */
  latest: MarketplaceVersion;
}

/** Picks the newest release compatible with this Saturn, and the newest overall. */
export function chooseVersion(entry: MarketplaceEntry): VersionChoice {
  const installable = entry.versions.find((v) => !v.saturnApi || satisfiesCaret(v.saturnApi, SATURN_API_VERSION)) ?? null;
  return { installable, latest: entry.versions[0] };
}

/** Compares dotted versions numerically ("1.10.0" > "1.9.2"); a negative result means a is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const ID = /^[a-z0-9][a-z0-9.-]*$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FILE = /^[\w.-]+\.json$/;

function validVersion(v: unknown, repo: string, needsApi: boolean): v is MarketplaceVersion {
  const r = v as MarketplaceVersion;
  return typeof r === 'object' && r !== null && typeof r.version === 'string' &&
    (needsApi ? typeof r.saturnApi === 'string' : r.saturnApi === undefined || typeof r.saturnApi === 'string') &&
    typeof r.download === 'string' && r.download.startsWith(`https://github.com/${repo}/releases/download/`) && r.download.endsWith('.zip') &&
    typeof r.sha256 === 'string' && SHA256.test(r.sha256);
}

/** Checks index.json; throws with a short reason if it isn't usable. */
export function parseMarketplaceIndex(v: unknown): MarketplaceIndex {
  const index = v as MarketplaceIndex;
  if (typeof index !== 'object' || index === null) throw new Error('The marketplace index is not valid');
  if (index.schema !== MARKETPLACE_SCHEMA) throw new Error(`The marketplace index uses schema ${String(index.schema)}; update Saturn to read it`);
  for (const kind of ['languages', 'themes', 'extensions'] as const) {
    if (typeof index[kind] !== 'string' || !FILE.test(index[kind])) throw new Error('The marketplace index is not valid');
  }
  return { schema: index.schema, languages: index.languages, themes: index.themes, extensions: index.extensions };
}

/** Checks one kind's list, keeping valid entries (and their valid versions). Throws if it isn't a list. */
export function parseMarketplaceList(kind: MarketplaceKind, v: unknown): MarketplaceEntry[] {
  if (!Array.isArray(v)) throw new Error(`The marketplace's ${kind} list is not valid`);
  const needsApi = kind !== 'themes';
  const entries: MarketplaceEntry[] = [];
  for (const e of v as MarketplaceEntry[]) {
    if (typeof e !== 'object' || e === null || typeof e.id !== 'string' || !ID.test(e.id)) continue;
    if (typeof e.name !== 'string' || typeof e.description !== 'string' || typeof e.author !== 'string') continue;
    if (typeof e.repo !== 'string' || !REPO.test(e.repo)) continue;
    if (e.image !== undefined && !(typeof e.image === 'string' && e.image.startsWith('https://'))) continue;
    const versions = Array.isArray(e.versions) ? e.versions.filter((r) => validVersion(r, e.repo, needsApi)) : [];
    if (versions.length === 0) continue;
    entries.push({ ...e, default: kind !== 'themes' ? e.default === true : undefined, versions });
  }
  return entries;
}
