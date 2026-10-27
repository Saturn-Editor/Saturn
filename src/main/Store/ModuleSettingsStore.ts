import type { SettingValue, SettingValues } from '@shared/modules';
import { FileStore } from './FileStore';

type AllSettings = Record<string, SettingValues>;

function isAll(v: unknown): v is AllSettings {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Values the user set for module-contributed settings, per module id. Unset ones use the manifest default. */
export class ModuleSettingsStore {
  private readonly store: FileStore<AllSettings>;

  constructor(file: string) {
    this.store = new FileStore(file, {}, isAll);
  }

  async values(moduleId: string): Promise<SettingValues> {
    return (await this.store.read())[moduleId] ?? {};
  }

  async set(moduleId: string, id: string, value: SettingValue): Promise<void> {
    await this.store.update((all) => ({ ...all, [moduleId]: { ...all[moduleId], [id]: value } }));
  }

  async forget(moduleId: string): Promise<void> {
    await this.store.update(({ [moduleId]: _gone, ...rest }) => rest);
  }
}
