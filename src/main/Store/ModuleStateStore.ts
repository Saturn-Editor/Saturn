import { FileStore } from './FileStore';

interface ModuleState {
  disabled: string[];
}

function isState(v: unknown): v is ModuleState {
  return Array.isArray((v as ModuleState)?.disabled);
}

/** Which installed modules the user has turned off. Modules are enabled by default. */
export class ModuleStateStore {
  private readonly store: FileStore<ModuleState>;

  constructor(file: string) {
    this.store = new FileStore(file, { disabled: [] }, isState);
  }

  async disabled(): Promise<Set<string>> {
    return new Set((await this.store.read()).disabled);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.store.update((s) => ({
      disabled: enabled ? s.disabled.filter((d) => d !== id) : [...new Set([...s.disabled, id])],
    }));
  }

  async forget(id: string): Promise<void> {
    await this.setEnabled(id, true);
  }
}
