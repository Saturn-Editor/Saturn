import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PROJECT_FOLDER, type RunEntry } from '@shared/types';
import type { AppPaths } from '../Helpers/AppPaths';
import { FileStore } from './FileStore';

interface RunChoice {
  selected: string | null;
}

/** Where run entries come from. Plan 3 registers one per language; this plan only has custom ones. */
export interface RunProvider {
  id: string;
  label: string;
  provide(projectPath: string): Promise<RunEntry[]>;
}

function isRunChoice(v: unknown): v is RunChoice {
  const d = v as RunChoice;
  return typeof d === 'object' && d !== null && (d.selected === null || typeof d.selected === 'string');
}

function isEntries(v: unknown): v is RunEntry[] {
  return Array.isArray(v) && v.every((e) => typeof e?.id === 'string' && typeof e?.name === 'string' && typeof e?.command === 'string');
}

/** Custom run commands live in the project's .saturn folder (shared); the last selection stays in app-data. */
export class RunConfigStore {
  private readonly shared = new Map<string, FileStore<RunEntry[]>>();
  private readonly choices = new Map<string, FileStore<RunChoice>>();

  constructor(private readonly paths: AppPaths) {}

  async list(projectPath: string): Promise<RunEntry[]> {
    return (await this.sharedFor(projectPath).read()).map((e) => ({ ...e, source: 'custom', group: 'Custom' }));
  }

  async addCustom(projectPath: string, input: { name: string; command: string }): Promise<RunEntry> {
    const name = input.name.trim();
    const command = input.command.trim();
    if (!name || !command) throw new Error('Name and command are required');
    const entry: RunEntry = { id: `custom:${randomUUID()}`, name, command, source: 'custom', group: 'Custom' };
    await this.sharedFor(projectPath).update((list) => [...list, { id: entry.id, name, command } as RunEntry]);
    await this.select(projectPath, entry.id);
    return entry;
  }

  async removeCustom(projectPath: string, id: string): Promise<void> {
    await this.sharedFor(projectPath).update((list) => list.filter((e) => e.id !== id));
    await this.choiceFor(projectPath).update((d) => ({ selected: d.selected === id ? null : d.selected }));
  }

  async selected(projectPath: string): Promise<string | null> {
    return (await this.choiceFor(projectPath).read()).selected;
  }

  async select(projectPath: string, id: string): Promise<void> {
    await this.choiceFor(projectPath).update(() => ({ selected: id }));
  }

  private sharedFor(projectPath: string): FileStore<RunEntry[]> {
    let store = this.shared.get(projectPath);
    if (!store) {
      store = new FileStore<RunEntry[]>(join(projectPath, PROJECT_FOLDER, 'run-configurations.json'), [], isEntries);
      this.shared.set(projectPath, store);
    }
    return store;
  }

  private choiceFor(projectPath: string): FileStore<RunChoice> {
    const key = this.paths.projectKey(projectPath);
    let store = this.choices.get(key);
    if (!store) {
      store = new FileStore<RunChoice>(this.paths.file(`run/${key}.json`), { selected: null }, isRunChoice);
      this.choices.set(key, store);
    }
    return store;
  }
}
