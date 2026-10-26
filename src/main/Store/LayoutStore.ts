import type { DockState, LayoutState } from '@shared/types';
import type { AppPaths } from '../Helpers/AppPaths';
import { FileStore } from './FileStore';

function isDock(v: unknown): v is DockState {
  const d = v as DockState;
  return (
    typeof d === 'object' && d !== null &&
    Array.isArray(d.panels) && d.panels.every((p) => typeof p === 'string') &&
    (d.active === null || typeof d.active === 'string') &&
    typeof d.size === 'number' && typeof d.open === 'boolean'
  );
}

function isLayout(v: unknown): v is LayoutState | null {
  if (v === null) return true;
  const docks = (v as LayoutState)?.docks;
  return typeof docks === 'object' && docks !== null && isDock(docks.left) && isDock(docks.bottom);
}

/** Per-project panel layout, kept in app-data and keyed by project path. */
export class LayoutStore {
  constructor(private readonly paths: AppPaths) {}

  load(projectPath: string): Promise<LayoutState | null> {
    return this.storeFor(projectPath).read();
  }

  save(projectPath: string, state: LayoutState): Promise<void> {
    return this.storeFor(projectPath).write(state);
  }

  private readonly stores = new Map<string, FileStore<LayoutState | null>>();

  /** One store per project, so saves for the same project stay serialised. */
  private storeFor(projectPath: string): FileStore<LayoutState | null> {
    const key = this.paths.projectKey(projectPath);
    let store = this.stores.get(key);
    if (!store) {
      store = new FileStore<LayoutState | null>(this.paths.file(`layouts/${key}.json`), null, isLayout);
      this.stores.set(key, store);
    }
    return store;
  }
}
