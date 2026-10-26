import { randomUUID } from 'node:crypto';
import type { RunEntry } from '@shared/types';
import type { AppPaths } from '../Helpers/AppPaths';
import { FileStore } from './FileStore';

interface RunData {
  custom: RunEntry[];
  selected: string | null;
}

/** Where run entries come from. Plan 3 registers one per language; this plan only has custom ones. */
export interface RunProvider {
  id: string;
  label: string;
  provide(projectPath: string): Promise<RunEntry[]>;
}

function isRunData(v: unknown): v is RunData {
  const d = v as RunData;
  return typeof d === 'object' && d !== null && Array.isArray(d.custom) && (d.selected === null || typeof d.selected === 'string');
}

/** Per-project custom run commands and the last selection, kept in app-data. */
export class RunConfigStore {
  private readonly stores = new Map<string, FileStore<RunData>>();

  constructor(private readonly paths: AppPaths) {}

  async list(projectPath: string): Promise<RunEntry[]> {
    return (await this.storeFor(projectPath).read()).custom.map((e) => ({ ...e, group: 'Custom' }));
  }

  async addCustom(projectPath: string, input: { name: string; command: string }): Promise<RunEntry> {
    const name = input.name.trim();
    const command = input.command.trim();
    if (!name || !command) throw new Error('Name and command are required');
    const entry: RunEntry = { id: `custom:${randomUUID()}`, name, command, source: 'custom', group: 'Custom' };
    await this.storeFor(projectPath).update((d) => ({ custom: [...d.custom, entry], selected: entry.id }));
    return entry;
  }

  async removeCustom(projectPath: string, id: string): Promise<void> {
    await this.storeFor(projectPath).update((d) => ({
      custom: d.custom.filter((e) => e.id !== id),
      selected: d.selected === id ? null : d.selected,
    }));
  }

  async selected(projectPath: string): Promise<string | null> {
    return (await this.storeFor(projectPath).read()).selected;
  }

  async select(projectPath: string, id: string): Promise<void> {
    await this.storeFor(projectPath).update((d) => ({ ...d, selected: id }));
  }

  private storeFor(projectPath: string): FileStore<RunData> {
    const key = this.paths.projectKey(projectPath);
    let store = this.stores.get(key);
    if (!store) {
      store = new FileStore<RunData>(this.paths.file(`run/${key}.json`), { custom: [], selected: null }, isRunData);
      this.stores.set(key, store);
    }
    return store;
  }
}
