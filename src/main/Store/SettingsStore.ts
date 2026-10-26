import { FileStore } from './FileStore';

export interface Settings {
  themeId: string;
}

const DEFAULTS: Settings = { themeId: 'saturn-dark' };

function isSettings(v: unknown): v is Settings {
  return typeof v === 'object' && v !== null && typeof (v as Settings).themeId === 'string';
}

export class SettingsStore {
  private readonly store: FileStore<Settings>;

  constructor(file: string) {
    this.store = new FileStore(file, DEFAULTS, isSettings);
  }

  get(): Promise<Settings> {
    return this.store.read();
  }

  async setThemeId(id: string): Promise<void> {
    await this.store.update((s) => ({ ...s, themeId: id }));
  }
}
