import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  THEME_MODES, THEME_TOKENS, type Theme, type ThemeFile, type ThemeMode, type ThemeSummary, type ThemeVariant,
} from '@shared/types';
import type { SettingsStore } from '../Store/SettingsStore';

interface LoadedTheme {
  theme: ThemeFile;
  builtIn: boolean;
}

export const DEFAULT_THEME_ID = 'saturn';

/**
 * Loads built-in themes (shipped JSON) and installed themes (`<appData>/themes/<id>/theme.json`).
 * Each theme has a light and/or dark variant; the user's Light/Dark mode picks which one is used.
 */
export class ThemeService {
  constructor(
    private readonly builtInDir: string,
    private readonly installedDir: string,
    private readonly settings: SettingsStore,
    /** The OS's current light/dark setting, used when "Sync with OS" is on. */
    private readonly systemMode: () => ThemeMode = () => 'dark',
  ) {}

  static validVariant(v: unknown): v is ThemeVariant {
    if (typeof v !== 'object' || v === null) return false;
    const t = v as ThemeVariant;
    return typeof t.colors === 'object' && t.colors !== null &&
      THEME_TOKENS.every((token) => typeof t.colors[token] === 'string') &&
      Array.isArray(t.syntax);
  }

  static validate(v: unknown): v is ThemeFile {
    if (typeof v !== 'object' || v === null) return false;
    const t = v as ThemeFile;
    const present = THEME_MODES.filter((m) => t[m] !== undefined);
    return typeof t.id === 'string' && typeof t.name === 'string' &&
      (t.version === undefined || typeof t.version === 'string') &&
      (t.description === undefined || typeof t.description === 'string') &&
      present.length > 0 && present.every((m) => ThemeService.validVariant(t[m]));
  }

  async list(): Promise<ThemeSummary[]> {
    return (await this.loadAll()).map(({ theme, builtIn }) => summary(theme, builtIn));
  }

  async active(): Promise<Theme> {
    const all = await this.loadAll();
    const { themeId } = await this.settings.get();
    return resolve((all.find((t) => t.theme.id === themeId) ?? all[0]).theme, await this.mode());
  }

  /** The mode in effect: the OS's when syncing with it, otherwise the user's choice. */
  async mode(): Promise<ThemeMode> {
    const { mode, syncWithOs } = await this.settings.get();
    return syncWithOs ? this.systemMode() : mode;
  }

  async syncWithOs(): Promise<boolean> {
    return (await this.settings.get()).syncWithOs ?? false;
  }

  async setSyncWithOs(on: boolean): Promise<Theme> {
    await this.settings.setSyncWithOs(on);
    return this.active();
  }

  async setActive(id: string): Promise<Theme> {
    if (!(await this.loadAll()).some((t) => t.theme.id === id)) throw new Error(`Unknown theme: ${id}`);
    await this.settings.setThemeId(id);
    return this.active();
  }

  /** Picking Light or Dark by hand turns Sync with OS off. */
  async setMode(mode: ThemeMode): Promise<Theme> {
    await this.settings.setMode(mode);
    await this.settings.setSyncWithOs(false);
    return this.active();
  }

  /** Copies a folder containing `theme.json` into app-data, replacing an older copy with the same id. */
  async install(fromDir: string): Promise<ThemeSummary> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(fromDir, 'theme.json'), 'utf8'));
    } catch {
      throw new Error('No valid theme.json in that folder');
    }
    if (!ThemeService.validate(parsed)) {
      throw new Error('theme.json needs an id, a name, and a light or dark variant with every colour token');
    }
    if ((await this.loadAll()).some((t) => t.builtIn && t.theme.id === parsed.id)) {
      throw new Error(`${parsed.id} is a built-in theme and can't be replaced`);
    }
    const target = join(this.installedDir, parsed.id);
    await rm(target, { recursive: true, force: true });
    await cp(fromDir, target, { recursive: true });
    return summary(parsed, false);
  }

  /** Removes an installed theme; if it was active, Saturn falls back to the default theme. */
  async uninstall(id: string): Promise<Theme | null> {
    const found = (await this.loadAll()).find((t) => t.theme.id === id);
    if (!found || found.builtIn) throw new Error(`${id} can't be uninstalled`);
    await rm(join(this.installedDir, id), { recursive: true, force: true });
    const { themeId } = await this.settings.get();
    return themeId === id ? this.setActive(DEFAULT_THEME_ID) : null;
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
  private async readThemes(files: string[]): Promise<ThemeFile[]> {
    const themes: ThemeFile[] = [];
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

function summary(theme: ThemeFile, builtIn: boolean): ThemeSummary {
  return {
    id: theme.id,
    name: theme.name,
    version: theme.version ?? null,
    description: theme.description ?? '',
    modes: THEME_MODES.filter((m) => theme[m]),
    builtIn,
  };
}

/** The requested variant, or the theme's only one when it lacks that mode. */
function resolve(theme: ThemeFile, mode: ThemeMode): Theme {
  const type = theme[mode] ? mode : THEME_MODES.find((m) => theme[m])!;
  const { colors, syntax } = theme[type]!;
  return { id: theme.id, name: theme.name, type, colors, syntax };
}
