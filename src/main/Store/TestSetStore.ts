import type { TestSet } from '@shared/modules';
import type { AppPaths } from '../Helpers/AppPaths';
import { FileStore } from './FileStore';

function isSets(v: unknown): v is TestSet[] {
  return Array.isArray(v) && v.every((s) => typeof s?.name === 'string' && Array.isArray(s?.tests));
}

export class TestSetStore {
  private readonly stores = new Map<string, FileStore<TestSet[]>>();

  constructor(private readonly paths: AppPaths) {}

  list(projectPath: string): Promise<TestSet[]> {
    return this.storeFor(projectPath).read();
  }

  async save(projectPath: string, set: TestSet): Promise<TestSet[]> {
    const name = set.name.trim();
    if (!name) throw new Error('Give the test set a name');
    const tests = set.tests.filter((t) => typeof t?.controllerId === 'string' && typeof t?.id === 'string');
    if (!tests.length) throw new Error('Select some tests first');
    return this.storeFor(projectPath).update((sets) => [...sets.filter((s) => s.name !== name), { name, tests }].sort((a, b) => a.name.localeCompare(b.name)));
  }

  remove(projectPath: string, name: string): Promise<TestSet[]> {
    return this.storeFor(projectPath).update((sets) => sets.filter((s) => s.name !== name));
  }

  private storeFor(projectPath: string): FileStore<TestSet[]> {
    const key = this.paths.projectKey(projectPath);
    let store = this.stores.get(key);
    if (!store) {
      store = new FileStore<TestSet[]>(this.paths.file(`test-sets/${key}.json`), [], isSets);
      this.stores.set(key, store);
    }
    return store;
  }
}
