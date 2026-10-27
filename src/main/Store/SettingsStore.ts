import { KEYMAPS, type KeymapId } from '@shared/keymaps';
import { MARKETPLACE_INDEX_URL } from '@shared/marketplace';
import { TEXT_SIZES, type AppSettings, type ThemeMode } from '@shared/types';
import { FileStore } from './FileStore';

export interface Settings {
  themeId: string;
  /** Which variant of the theme to use. */
  mode: ThemeMode;
  /** Set once the first-launch welcome popup has been closed. */
  onboarded?: boolean;
  /** Language-server completion while typing; on unless turned off. */
  completion?: boolean;
  /** A replacement marketplace index URL; unset means the official one. */
  marketplaceUrl?: string;
  keymap?: KeymapId;
  textSize?: number;
  /** Follow the OS's light/dark setting instead of `mode`. */
  syncWithOs?: boolean;
}

const DEFAULTS: Settings = { themeId: 'saturn', mode: 'dark' };

function isSettings(v: unknown): v is Settings {
  const s = v as Settings;
  return typeof s === 'object' && s !== null && typeof s.themeId === 'string' && (s.mode === 'light' || s.mode === 'dark');
}

export class SettingsStore {
  private readonly store: FileStore<Settings>;

  constructor(file: string) {
    this.store = new FileStore(file, DEFAULTS, isSettings);
  }

  get(): Promise<Settings> {
    return this.store.read();
  }

  /** The user-editable settings shown in the Settings window, with defaults filled in. */
  async app(): Promise<AppSettings> {
    const s = await this.store.read();
    return {
      completion: s.completion ?? true,
      keymap: s.keymap ?? 'os',
      textSize: s.textSize ?? 100,
      marketplaceUrl: s.marketplaceUrl ?? MARKETPLACE_INDEX_URL,
    };
  }

  /** Saves Settings-window changes. The marketplace URL must be https; the official URL is stored as unset. */
  async updateApp(change: Partial<AppSettings>): Promise<AppSettings> {
    let marketplaceUrl: string | undefined;
    if (change.marketplaceUrl !== undefined) {
      const trimmed = change.marketplaceUrl.trim();
      if (trimmed && trimmed !== MARKETPLACE_INDEX_URL) {
        let url: URL;
        try {
          url = new URL(trimmed);
        } catch {
          throw new Error("That isn't a valid URL");
        }
        if (url.protocol !== 'https:') throw new Error('The marketplace URL must start with https://');
        marketplaceUrl = url.href;
      }
    }
    if (change.keymap !== undefined && !KEYMAPS.some((k) => k.id === change.keymap)) throw new Error(`Unknown keymap: ${change.keymap}`);
    if (change.textSize !== undefined && !(TEXT_SIZES as readonly number[]).includes(change.textSize)) throw new Error(`Unsupported text size: ${change.textSize}%`);
    await this.store.update((s) => ({
      ...s,
      ...(change.completion !== undefined && { completion: change.completion }),
      ...(change.keymap !== undefined && { keymap: change.keymap }),
      ...(change.textSize !== undefined && { textSize: change.textSize }),
      ...(change.marketplaceUrl !== undefined && { marketplaceUrl }),
    }));
    return this.app();
  }

  async setThemeId(id: string): Promise<void> {
    await this.store.update((s) => ({ ...s, themeId: id }));
  }

  async setMode(mode: ThemeMode): Promise<void> {
    await this.store.update((s) => ({ ...s, mode }));
  }

  async setSyncWithOs(on: boolean): Promise<void> {
    await this.store.update((s) => ({ ...s, syncWithOs: on }));
  }

  async setOnboarded(): Promise<void> {
    await this.store.update((s) => ({ ...s, onboarded: true }));
  }
}
