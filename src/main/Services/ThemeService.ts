import { existsSync } from 'node:fs';
import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { ICON_FILES, ICON_SCHEME } from '@shared/modules';
import { join } from 'node:path';
import {
  THEME_FONT, THEME_MODES, THEME_TOKENS, type Theme, type ThemeFile, type ThemeMode, type ThemeSummary, type ThemeVariant,
} from '@shared/types';
import type { SettingsStore } from '../Store/SettingsStore';

interface LoadedTheme {
  theme: ThemeFile;
  builtIn: boolean;
  missing: string[];
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

  static validate(v: unknown): v is ThemeFile {
    if (typeof v !== 'object' || v === null) return false;
    const t = v as ThemeFile;
    const present = THEME_MODES.filter((m) => typeof t[m] === 'object' && t[m] !== null);
    return typeof t.id === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(t.id) && typeof t.name === 'string' &&
      (t.version === undefined || typeof t.version === 'string') &&
      (t.description === undefined || typeof t.description === 'string') &&
      present.length > 0;
  }

  /** Fills anything missing or invalid from Saturn's own theme, listing what was filled. */
  static complete(theme: ThemeFile, fallback: ThemeFile | undefined): { theme: ThemeFile; missing: string[] } {
    const missing = new Set<string>();
    const done: ThemeFile = { id: theme.id, name: theme.name, version: theme.version, description: theme.description };
    for (const mode of THEME_MODES) {
      const variant = theme[mode];
      if (typeof variant !== 'object' || variant === null) continue;
      const base = fallback?.[mode] ?? fallback?.[THEME_MODES.find((m) => fallback[m])!];
      const colors = {} as ThemeVariant['colors'];
      for (const token of THEME_TOKENS) {
        const value = (variant.colors as Partial<ThemeVariant['colors']> | undefined)?.[token];
        if (typeof value === 'string') colors[token] = value;
        else {
          missing.add(`${token} colour`);
          colors[token] = base?.colors[token] ?? 'neutral-500';
        }
      }
      const syntax = Array.isArray(variant.syntax) ? variant.syntax.filter((r) => typeof r?.scope === 'string') : null;
      if (!syntax) missing.add('syntax colours');
      done[mode] = { colors, syntax: syntax ?? base?.syntax ?? [] };
    }
    const fonts = typeof theme.fonts === 'object' && theme.fonts !== null ? theme.fonts : {};
    for (const key of ['ui', 'editor'] as const) {
      const value = fonts[key];
      if (value === undefined) continue;
      if (typeof value === 'string' && THEME_FONT.test(value)) done.fonts = { ...done.fonts, [key]: value };
      else missing.add(`${key === 'ui' ? 'text' : 'code'} font (invalid)`);
    }
    return { theme: done, missing: [...missing] };
  }

  async incomplete(): Promise<{ name: string; missing: string[] }[]> {
    return (await this.loadAll()).filter((t) => t.missing.length).map((t) => ({ name: t.theme.name, missing: t.missing }));
  }

  async list(): Promise<ThemeSummary[]> {
    return (await this.loadAll()).map(({ theme, builtIn }) => summary(theme, builtIn, this.installedDir));
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
      throw new Error('theme.json needs an id, a name, and a light or dark variant');
    }
    if ((await this.loadAll()).some((t) => t.builtIn && t.theme.id === parsed.id)) {
      throw new Error(`${parsed.id} is a built-in theme and can't be replaced`);
    }
    const target = join(this.installedDir, parsed.id);
    await rm(target, { recursive: true, force: true });
    await cp(fromDir, target, { recursive: true });
    return summary(parsed, false, this.installedDir);
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
    const fallback = builtIn.find((t) => t.id === DEFAULT_THEME_ID);
    return [
      ...builtIn.map((raw) => ({ ...ThemeService.complete(raw, fallback), builtIn: true })),
      ...installed.map((raw) => ({ ...ThemeService.complete(raw, fallback), builtIn: false })),
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

/** `installedDir` is where installed themes live; built-in themes have no icon. */
function summary(theme: ThemeFile, builtIn: boolean, installedDir: string): ThemeSummary {
  const dir = join(installedDir, theme.id);
  const hasIcon = !builtIn && ICON_FILES.some((f) => existsSync(join(dir, f)));
  return {
    id: theme.id,
    name: theme.name,
    version: theme.version ?? null,
    description: theme.description ?? '',
    icon: hasIcon ? `${ICON_SCHEME}://theme/${theme.id}?v=${encodeURIComponent(theme.version ?? '')}` : null,
    modes: THEME_MODES.filter((m) => theme[m]),
    builtIn,
  };
}

/** The requested variant, or the theme's only one when it lacks that mode. */
function resolve(theme: ThemeFile, mode: ThemeMode): Theme {
  const type = theme[mode] ? mode : THEME_MODES.find((m) => theme[m])!;
  const { colors, syntax } = theme[type]!;
  return { id: theme.id, name: theme.name, type, colors, syntax, fonts: theme.fonts ?? {} };
}
