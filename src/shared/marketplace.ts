/** The marketplace index, hosted in the Saturn-Editor/Marketplace repo. */
export const MARKETPLACE_INDEX_URL = 'https://raw.githubusercontent.com/Saturn-Editor/Marketplace/refs/heads/main/index.json';

/** The index `schema` this build understands; any other is rejected. */
export const MARKETPLACE_SCHEMA = 1;

interface MarketplaceEntryBase {
  id: string;
  name: string;
  description: string;
  author: string;
  /** Source repo as "owner/name". */
  repo: string;
  version: string;
  /** GitHub Release zip URL. */
  download: string;
  sha256: string;
  /** A picture for the Marketplace (https URL); a two-letter badge from the name is shown without one. */
  image?: string;
}

export interface MarketplaceLanguage extends MarketplaceEntryBase {
  saturnApi: string;
  /** Pre-selected in the first-launch welcome popup. */
  default?: boolean;
}

/** An extension's zip has saturn-extension.json at its root. */
export interface MarketplaceExtension extends MarketplaceEntryBase {
  saturnApi: string;
}

/** A theme zip's theme.json holds its light and/or dark variant; the user's mode picks one. */
export type MarketplaceTheme = MarketplaceEntryBase;

export interface MarketplaceIndex {
  schema: number;
  languages: MarketplaceLanguage[];
  /** Read as empty while the index has no "extensions" array yet. */
  extensions: MarketplaceExtension[];
  themes: MarketplaceTheme[];
}

const ID = /^[a-z0-9][a-z0-9.-]*$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

function validEntry(v: unknown): v is MarketplaceEntryBase {
  const e = v as MarketplaceEntryBase;
  return typeof e === 'object' && e !== null &&
    typeof e.id === 'string' && ID.test(e.id) &&
    typeof e.name === 'string' && typeof e.description === 'string' && typeof e.author === 'string' &&
    typeof e.version === 'string' &&
    typeof e.repo === 'string' && REPO.test(e.repo) &&
    typeof e.download === 'string' && e.download.startsWith(`https://github.com/${e.repo}/releases/download/`) && e.download.endsWith('.zip') &&
    typeof e.sha256 === 'string' && SHA256.test(e.sha256) &&
    (e.image === undefined || (typeof e.image === 'string' && e.image.startsWith('https://')));
}

/** Checks the index shape; throws with a short reason if it isn't usable. */
export function parseMarketplaceIndex(v: unknown): MarketplaceIndex {
  const index = v as MarketplaceIndex;
  if (typeof index !== 'object' || index === null) throw new Error('The marketplace index is not valid');
  if (index.schema !== MARKETPLACE_SCHEMA) throw new Error(`The marketplace index uses schema ${String(index.schema)}; update Saturn to read it`);
  if (!Array.isArray(index.languages) || !Array.isArray(index.themes)) throw new Error('The marketplace index is not valid');
  return {
    schema: index.schema,
    languages: index.languages.filter((l) => validEntry(l) && typeof l.saturnApi === 'string'),
    extensions: (Array.isArray(index.extensions) ? index.extensions : []).filter((x) => validEntry(x) && typeof x.saturnApi === 'string'),
    themes: index.themes.filter(validEntry),
  };
}
