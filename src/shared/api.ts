import type {
  DirEntry, FileReadResult, LayoutState, NewProjectRequest, RecentProject,
  RunEntry, Theme, ThemeSummary, Unsubscribe, WindowKind,
} from './types';
import type { CompletionItem, CompletionRequest, ContributionSnapshot, ModuleSummary, TreeItem } from './modules';

export const CHANNEL_PREFIX = 'saturn:';

/** Builds an IPC channel name, e.g. channel('themes', 'setActive') → 'saturn:themes.setActive'. */
export function channel(area: string, name: string): string {
  return `${CHANNEL_PREFIX}${area}.${name}`;
}

export interface SaturnApi {
  window: {
    kind: WindowKind;
    projectPath: string | null;
    /** Which section a Settings or Marketplace window should open on, if given. */
    section: string | null;
    setDirty(dirty: boolean): void;
    close(): void;
    /** Main asks the editor to save everything before closing (from the unsaved-changes prompt). */
    onSaveAll(cb: () => void): Unsubscribe;
  };
  windows: {
    openSettings(section?: 'appearance'): void;
    openNewProject(): void;
    openMarketplace(section?: 'themes' | 'languages'): void;
  };
  modules: {
    list(): Promise<ModuleSummary[]>;
    /** Asks for a folder and installs the module in it; null if cancelled. */
    installDialog(): Promise<ModuleSummary | null>;
    uninstall(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    snapshot(): Promise<ContributionSnapshot>;
    onChanged(cb: (snapshot: ContributionSnapshot) => void): Unsubscribe;
    grammar(languageId: string): Promise<unknown | null>;
    grammarByScope(scopeName: string): Promise<unknown | null>;
    runCommand(id: string): Promise<void>;
    treeChildren(panelId: string, parentId: string | null): Promise<TreeItem[]>;
    onTreeRefresh(cb: (panelId: string) => void): Unsubscribe;
    renderPreview(id: string, text: string, path: string): Promise<string>;
    templateFile(id: string, name: string, dir: string): Promise<{ fileName: string | null; content: string }>;
    complete(req: CompletionRequest): Promise<CompletionItem[]>;
    onOpenFile(cb: (path: string, line?: number) => void): Unsubscribe;
    onHostProblem(cb: (message: string) => void): Unsubscribe;
  };
  projects: {
    recent(): Promise<RecentProject[]>;
    openDialog(): Promise<void>;
    openPath(path: string): Promise<'opened' | 'missing'>;
    removeRecent(path: string): Promise<void>;
    pickFolder(): Promise<string | null>;
    create(req: NewProjectRequest): Promise<void>;
    defaultParentDir(): Promise<string>;
  };
  themes: {
    list(): Promise<ThemeSummary[]>;
    active(): Promise<Theme>;
    setActive(id: string): Promise<void>;
    /** Asks for a folder containing theme.json and installs it; null if cancelled. */
    installDialog(): Promise<ThemeSummary | null>;
    uninstall(id: string): Promise<void>;
    onChanged(cb: (t: Theme) => void): Unsubscribe;
    onListChanged(cb: () => void): Unsubscribe;
  };
  fs: {
    readDir(path: string): Promise<DirEntry[]>;
    readFile(path: string, opts?: { force?: boolean }): Promise<FileReadResult>;
    writeFile(path: string, text: string): Promise<void>;
    /** Creates a file (optionally with starting text); rejects if anything already exists there. */
    createFile(path: string, text?: string): Promise<void>;
    createDir(path: string): Promise<void>;
    onChanged(cb: (dir: string) => void): Unsubscribe;
  };
  layout: {
    load(): Promise<LayoutState | null>;
    save(state: LayoutState): Promise<void>;
  };
  terminal: {
    create(opts: { cwd: string; name: string; command?: string }): Promise<string>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): void;
    onData(cb: (id: string, data: string) => void): Unsubscribe;
    onExit(cb: (id: string, code: number) => void): Unsubscribe;
  };
  run: {
    list(): Promise<RunEntry[]>;
    addCustom(e: { name: string; command: string }): Promise<RunEntry>;
    removeCustom(id: string): Promise<void>;
    selected(): Promise<string | null>;
    select(id: string): Promise<void>;
  };
}
