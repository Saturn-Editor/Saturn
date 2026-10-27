import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import {
  chooseVersion, compareVersions, parseMarketplaceIndex, parseMarketplaceList, type MarketplaceEntry, type MarketplaceKind,
} from '@shared/marketplace';
import type { ThemeSummary } from '@shared/types';
import { MANIFEST_FILES, type ModuleKind } from '@shared/modules';
import type { CodeModuleService } from './CodeModuleService';
import type { ThemeService } from './ThemeService';

/** How long the index fetch may take before the Marketplace says it can't connect. */
const INDEX_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** A newer version of something installed that this Saturn can install. */
export interface AvailableUpdate {
  kind: MarketplaceKind;
  id: string;
  name: string;
  from: string;
  to: string;
}

/**
 * Fetches the GitHub-hosted index and installs entries from it: download the release zip, check its
 * SHA-256, unzip it to a temp folder, then hand that folder to the normal module or theme install.
 */
export class MarketplaceService {
  /** Lists last fetched per kind; installs use these, so an entry can't change under the Marketplace window. */
  private readonly lists = new Map<MarketplaceKind, MarketplaceEntry[]>();

  constructor(
    private readonly modules: CodeModuleService,
    private readonly themes: ThemeService,
    /** The index URL from Settings (the official one unless the user changed it). */
    private readonly indexUrl: () => Promise<string>,
  ) {}

  /** Fetches index.json, then the one kind's list it points to (relative to index.json). */
  async fetchList(kind: MarketplaceKind): Promise<MarketplaceEntry[]> {
    const indexUrl = await this.indexUrl();
    const index = parseMarketplaceIndex(await this.getJson(indexUrl));
    const list = parseMarketplaceList(kind, await this.getJson(new URL(index[kind], indexUrl).href));
    this.lists.set(kind, list);
    return list;
  }

  /** Installs a language or extension: the newest release compatible with this Saturn. */
  async installModule(kind: ModuleKind, id: string): Promise<void> {
    const entry = await this.entry(kind === 'language' ? 'languages' : 'extensions', id);
    const release = chooseVersion(entry).installable;
    if (!release) throw new Error(`Every version of ${entry.name} needs a newer Saturn; update Saturn to install it`);
    const file = MANIFEST_FILES[kind];
    await this.withDownload(release.download, release.sha256, async (dir) => {
      const manifest = await readJson(join(dir, file), `The download has no ${file}`) as { id?: string; version?: string };
      if (manifest.id !== entry.id || manifest.version !== release.version) {
        throw new Error(`The download doesn't match ${entry.name} ${release.version} in the marketplace`);
      }
      await this.modules.install(kind, dir);
    });
  }

  async installTheme(id: string): Promise<ThemeSummary> {
    const entry = await this.entry('themes', id);
    const release = entry.versions[0];
    return this.withDownload(release.download, release.sha256, async (dir) => {
      const theme = await readJson(join(dir, 'theme.json'), 'The download has no theme.json') as { id?: string; version?: string };
      if (theme.id !== entry.id || theme.version !== release.version) throw new Error(`The download doesn't match ${entry.name} ${release.version} in the marketplace`);
      return this.themes.install(dir);
    });
  }

  /** Installed languages, extensions and themes with a newer compatible version in the marketplace. */
  async availableUpdates(): Promise<AvailableUpdate[]> {
    const installed: Record<MarketplaceKind, { id: string; version: string | null }[]> = {
      languages: await this.modules.summaries('language'),
      extensions: await this.modules.summaries('extension'),
      themes: (await this.themes.list()).filter((t) => !t.builtIn),
    };
    const found: AvailableUpdate[] = [];
    for (const kind of Object.keys(installed) as MarketplaceKind[]) {
      if (!installed[kind].length) continue;
      const list = await this.fetchList(kind);
      for (const item of installed[kind]) {
        const entry = list.find((e) => e.id === item.id);
        const best = entry && chooseVersion(entry).installable;
        if (best && item.version && compareVersions(best.version, item.version) > 0) {
          found.push({ kind, id: item.id, name: entry.name, from: item.version, to: best.version });
        }
      }
    }
    return found;
  }

  /** Installs the given updates; one failing doesn't stop the rest. Rejects listing what failed. */
  async installUpdates(updates: AvailableUpdate[]): Promise<void> {
    const failed: string[] = [];
    for (const u of updates) {
      await (u.kind === 'themes' ? this.installTheme(u.id) : this.installModule(u.kind === 'languages' ? 'language' : 'extension', u.id))
        .catch(() => failed.push(u.name));
    }
    if (failed.length) throw new Error(`Couldn't update ${failed.join(', ')}`);
  }

  /** Drops the cached lists, e.g. after the marketplace URL changes. */
  forgetIndex(): void {
    this.lists.clear();
  }

  private async entry(kind: MarketplaceKind, id: string): Promise<MarketplaceEntry> {
    const list = this.lists.get(kind) ?? await this.fetchList(kind);
    const entry = list.find((e) => e.id === id);
    if (!entry) throw new Error(`${id} isn't in the marketplace`);
    return entry;
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) throw new Error(`The marketplace returned ${res.status}`);
    return res.json();
  }

  private async withDownload<T>(url: string, sha256: string, use: (dir: string) => Promise<T>): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`The download failed (${res.status})`);
    const zip = new Uint8Array(await res.arrayBuffer());
    if (createHash('sha256').update(zip).digest('hex') !== sha256) throw new Error("The download's checksum doesn't match the marketplace");
    const dir = await mkdtemp(join(tmpdir(), 'saturn-marketplace-'));
    try {
      await extract(zip, dir);
      return await use(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

async function readJson(file: string, missing: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error(missing);
  }
}

/** Unzips into `dir`, refusing any entry that would land outside it. */
async function extract(zip: Uint8Array, dir: string): Promise<void> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new Error("The download isn't a valid zip");
  }
  const root = resolve(dir) + sep;
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const target = resolve(dir, name);
    if (!target.startsWith(root)) throw new Error('The download contains an unsafe path');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
}
