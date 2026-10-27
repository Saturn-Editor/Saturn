import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { parseMarketplaceIndex, type MarketplaceIndex } from '@shared/marketplace';
import type { ThemeSummary } from '@shared/types';
import { MANIFEST_FILE, type ModuleService } from './ModuleService';
import type { ThemeService } from './ThemeService';

/** How long the index fetch may take before the Marketplace says it can't connect. */
const INDEX_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * Fetches the GitHub-hosted index and installs entries from it: download the release zip, check its
 * SHA-256, unzip it to a temp folder, then hand that folder to the normal module or theme install.
 */
export class MarketplaceService {
  private index: MarketplaceIndex | null = null;

  constructor(
    private readonly modules: ModuleService,
    private readonly themes: ThemeService,
    /** The index URL from Settings (the official one unless the user changed it). */
    private readonly indexUrl: () => Promise<string>,
  ) {}

  async fetchIndex(): Promise<MarketplaceIndex> {
    const res = await fetch(await this.indexUrl(), { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) throw new Error(`The marketplace returned ${res.status}`);
    this.index = parseMarketplaceIndex(await res.json());
    return this.index;
  }

  async installLanguage(id: string): Promise<void> {
    const entry = (await this.currentIndex()).languages.find((l) => l.id === id);
    if (!entry) throw new Error(`${id} isn't in the marketplace`);
    await this.withDownload(entry.download, entry.sha256, async (dir) => {
      const manifest = await readJson(join(dir, MANIFEST_FILE), `The download has no ${MANIFEST_FILE}`) as { id?: string; version?: string };
      if (manifest.id !== entry.id || manifest.version !== entry.version) {
        throw new Error(`The download doesn't match ${entry.name} ${entry.version} in the marketplace`);
      }
      await this.modules.install(dir);
    });
  }

  async installTheme(id: string): Promise<ThemeSummary> {
    const entry = (await this.currentIndex()).themes.find((t) => t.id === id);
    if (!entry) throw new Error(`${id} isn't in the marketplace`);
    return this.withDownload(entry.download, entry.sha256, async (dir) => {
      const theme = await readJson(join(dir, 'theme.json'), 'The download has no theme.json') as { id?: string; version?: string };
      if (theme.id !== entry.id || theme.version !== entry.version) throw new Error(`The download doesn't match ${entry.name} ${entry.version} in the marketplace`);
      return this.themes.install(dir);
    });
  }

  /** Drops the cached index, e.g. after the marketplace URL changes. */
  forgetIndex(): void {
    this.index = null;
  }

  /** Installs use the index the Marketplace window last showed, so the entry can't change underneath it. */
  private async currentIndex(): Promise<MarketplaceIndex> {
    return this.index ?? this.fetchIndex();
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
