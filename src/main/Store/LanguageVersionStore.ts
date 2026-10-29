import type { LanguageVersion } from '@shared/modules';
import type { AppPaths } from '../Helpers/AppPaths';
import { FileStore } from './FileStore';

type Versions = Record<string, LanguageVersion>;

function isVersions(v: unknown): v is Versions {
  return typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x?.id === 'string' && typeof x?.label === 'string');
}

export class LanguageVersionStore {
  private readonly stores = new Map<string, FileStore<Versions>>();

  constructor(private readonly paths: AppPaths) {}

  forProject(projectPath: string): Promise<Versions> {
    return this.storeFor(projectPath).read();
  }

  async get(projectPath: string, languageId: string): Promise<LanguageVersion | null> {
    return (await this.forProject(projectPath))[languageId] ?? null;
  }

  set(projectPath: string, languageId: string, version: LanguageVersion): Promise<Versions> {
    if (typeof version?.id !== 'string' || typeof version.label !== 'string') throw new Error('Invalid version');
    const stored: LanguageVersion = { id: version.id, label: version.label, ...(typeof version.detail === 'string' && { detail: version.detail }) };
    return this.storeFor(projectPath).update((all) => ({ ...all, [languageId]: stored }));
  }

  private storeFor(projectPath: string): FileStore<Versions> {
    const key = this.paths.projectKey(projectPath);
    let store = this.stores.get(key);
    if (!store) {
      store = new FileStore<Versions>(this.paths.file(`language-versions/${key}.json`), {}, isVersions);
      this.stores.set(key, store);
    }
    return store;
  }
}
