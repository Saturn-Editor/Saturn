import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { THEME_TOKENS, type Theme, type ThemeSummary } from '@shared/types';
import type { SettingsStore } from '../Store/SettingsStore';

interface LoadedTheme {
  theme: Theme;
  builtIn: boolean;
}

/** Loads built-in themes (shipped JSON) and installed themes (`<appData>/themes/<id>/theme.json`). */
export class ThemeService {
  constructor(
    private readonly builtInDir: string,
    private readonly installedDir: string,
    private readonly settings: SettingsStore,
  ) {}

  static validate(v: unknown): v is Theme {
    if (typeof v !== 'object' || v === null) return false;
    const t = v as Theme;
    return (
      typeof t.id === 'string' &&
      typeof t.name === 'string' &&
      (t.type === 'light' || t.type === 'dark') &&
      typeof t.colors === 'object' && t.colors !== null &&
      THEME_TOKENS.every((token) => typeof t.colors[token] === 'string') &&
      Array.isArray(t.syntax)
    );
  }

  async list(): Promise<ThemeSummary[]> {
    return (await this.loadAll()).map(({ theme, builtIn }) => ({
      id: theme.id, name: theme.name, type: theme.type, builtIn,
    }));
  }

  async active(): Promise<Theme> {
    const all = await this.loadAll();
    const { themeId } = await this.settings.get();
    return (all.find((t) => t.theme.id === themeId) ?? all[0]).theme;
  }

  async setActive(id: string): Promise<Theme> {
    const found = (await this.loadAll()).find((t) => t.theme.id === id);
    if (!found) throw new Error(`Unknown theme: ${id}`);
    await this.settings.setThemeId(id);
    return found.theme;
  }

  /** Copies a folder containing `theme.json` into app-data, replacing an older copy with the same id. */
  async install(fromDir: string): Promise<ThemeSummary> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(fromDir, 'theme.json'), 'utf8'));
    } catch {
      throw new Error('No valid theme.json in that folder');
    }
    if (!ThemeService.validate(parsed)) throw new Error('theme.json is missing an id, name, type or one of the colour tokens');
    if ((await this.loadAll()).some((t) => t.builtIn && t.theme.id === parsed.id)) {
      throw new Error(`${parsed.id} is a built-in theme and can't be replaced`);
    }
    const target = join(this.installedDir, parsed.id);
    await rm(target, { recursive: true, force: true });
    await cp(fromDir, target, { recursive: true });
    return { id: parsed.id, name: parsed.name, type: parsed.type, builtIn: false };
  }

  /** Removes an installed theme; if it was active, Saturn falls back to the default theme. */
  async uninstall(id: string): Promise<Theme | null> {
    const found = (await this.loadAll()).find((t) => t.theme.id === id);
    if (!found || found.builtIn) throw new Error(`${id} can't be uninstalled`);
    await rm(join(this.installedDir, id), { recursive: true, force: true });
    const { themeId } = await this.settings.get();
    return themeId === id ? this.setActive('saturn-dark') : null;
  }

  private async loadAll(): Promise<LoadedTheme[]> {
    const builtIn = await this.readThemes(await this.jsonFiles(this.builtInDir));
    const installedFiles = (await this.subdirs(this.installedDir)).map((d) => join(this.installedDir, d, 'theme.json'));
    const installed = await this.readThemes(installedFiles);
    return [
      ...builtIn.map((theme) => ({ theme, builtIn: true })),
      ...installed.map((theme) => ({ theme, builtIn: false })),
    ];
  }

  /** Reads each file, silently skipping any that are missing, corrupt or invalid. */
  private async readThemes(files: string[]): Promise<Theme[]> {
    const themes: Theme[] = [];
    for (const file of files) {
      try {
        const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
        if (ThemeService.validate(parsed)) themes.push(parsed);
      } catch {
        // A broken theme must never stop the app from starting.
      }
    }
    return themes;
  }

  private async jsonFiles(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, f));
    } catch {
      return [];
    }
  }

  private async subdirs(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  }
}
