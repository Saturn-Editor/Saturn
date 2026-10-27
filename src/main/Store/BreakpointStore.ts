import type { Breakpoint } from '@shared/types';
import { FileStore } from './FileStore';

/** Project path → file path → breakpoints. */
type Breakpoints = Record<string, Record<string, Breakpoint[]>>;

function isBreakpoints(v: unknown): v is Breakpoints {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Breakpoints per project, kept between sessions. */
export class BreakpointStore {
  private readonly store: FileStore<Breakpoints>;

  constructor(file: string) {
    this.store = new FileStore(file, {}, isBreakpoints);
  }

  async forProject(projectPath: string): Promise<Record<string, Breakpoint[]>> {
    return (await this.store.read())[projectPath] ?? {};
  }

  async set(projectPath: string, path: string, list: Breakpoint[]): Promise<void> {
    await this.store.update((all) => {
      const project = { ...(all[projectPath] ?? {}) };
      if (list.length) project[path] = [...list].sort((a, b) => a.line - b.line);
      else delete project[path];
      return { ...all, [projectPath]: project };
    });
  }
}
