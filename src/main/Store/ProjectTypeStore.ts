import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RecentTypedProject } from '@shared/types';
import { FileStore } from './FileStore';

type Stored = Omit<RecentTypedProject, 'missing'>;
type Data = Record<string, Stored[]>;

function isData(v: unknown): v is Data {
  return typeof v === 'object' && v !== null && Object.values(v).every((list) => Array.isArray(list)
    && list.every((p) => typeof p?.path === 'string' && typeof p?.name === 'string' && typeof p?.openedAt === 'number'));
}

export class ProjectTypeStore {
  private readonly store: FileStore<Data>;

  constructor(file: string) {
    this.store = new FileStore<Data>(file, {}, isData);
  }

  async list(typeId: string): Promise<RecentTypedProject[]> {
    const list = (await this.store.read())[typeId] ?? [];
    return Promise.all(list.map(async (p) => ({ ...p, missing: !(await stat(p.path).then((s) => s.isDirectory(), () => false)) })));
  }

  async touch(typeId: string, path: string, name: string): Promise<void> {
    const full = resolve(path);
    await this.store.update((data) => ({
      ...data,
      [typeId]: [{ path: full, name, openedAt: Date.now() }, ...(data[typeId] ?? []).filter((p) => p.path !== full)],
    }));
  }

  async remove(typeId: string, path: string): Promise<void> {
    const full = resolve(path);
    await this.store.update((data) => ({ ...data, [typeId]: (data[typeId] ?? []).filter((p) => p.path !== full) }));
  }
}
