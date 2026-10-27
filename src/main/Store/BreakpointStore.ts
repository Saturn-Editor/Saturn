import { FileStore } from './FileStore';

/** Project path → file path → 1-based breakpoint lines. */
type Breakpoints = Record<string, Record<string, number[]>>;

function isBreakpoints(v: unknown): v is Breakpoints {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Breakpoints per project, kept between sessions. */
export class BreakpointStore {
  private readonly store: FileStore<Breakpoints>;

  constructor(file: string) {
    this.store = new FileStore(file, {}, isBreakpoints);
  }

  async forProject(projectPath: string): Promise<Record<string, number[]>> {
    return (await this.store.read())[projectPath] ?? {};
  }

  async set(projectPath: string, path: string, lines: number[]): Promise<void> {
    await this.store.update((all) => {
      const project = { ...(all[projectPath] ?? {}) };
      if (lines.length) project[path] = [...new Set(lines)].sort((a, b) => a - b);
      else delete project[path];
      return { ...all, [projectPath]: project };
    });
  }
}
