import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { RecentProject } from '@shared/types';
import { FileStore } from './FileStore';

type StoredProject = Omit<RecentProject, 'missing'>;

const LIMIT = 20;

function isStoredList(v: unknown): v is StoredProject[] {
  return Array.isArray(v) && v.every((p) => typeof p?.path === 'string' && typeof p?.openedAt === 'number' && Array.isArray(p?.languageIds));
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}

export class RecentProjectsStore {
  private readonly store: FileStore<StoredProject[]>;

  constructor(file: string) {
    this.store = new FileStore(file, [], isStoredList);
  }

  async list(): Promise<RecentProject[]> {
    const stored = await this.store.read();
    return Promise.all(stored.map(async (p) => ({ ...p, missing: !(await this.exists(p.path)) })));
  }

  /** Records an opened project. `languageIds` replaces the stored list when given (main language first). */
  async touch(path: string, languageIds?: string[]): Promise<void> {
    const full = resolve(path);
    const previousIds = (await this.list()).find((p) => samePath(p.path, full))?.languageIds ?? [];
    await this.store.update((list) => {
      const entry: StoredProject = {
        path: full,
        name: basename(full),
        openedAt: Date.now(),
        languageIds: languageIds ?? previousIds,
      };
      return [entry, ...list.filter((p) => !samePath(p.path, full))].slice(0, LIMIT);
    });
  }

  async remove(path: string): Promise<void> {
    await this.store.update((list) => list.filter((p) => !samePath(p.path, path)));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }
}
