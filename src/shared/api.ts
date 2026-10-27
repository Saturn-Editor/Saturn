import type {
  AppFolder, AppInfo, AppSettings, DirEntry, FileReadResult, LayoutState, NewProjectRequest, RecentProject,
  RunEntry, Theme, ThemeMode, ThemeSummary, Unsubscribe, WindowKind,
} from './types';
import type {
  CompletionItem, CompletionRequest, ContributionSnapshot, Diagnostic, ModuleMessage, ModuleSummary, SettingValue, SettingValues,
  SourceLocation, TreeItem,
} from './modules';
import type { MarketplaceIndex } from './marketplace';

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
    /** A module's contributed settings, with defaults filled in. */
    settings(moduleId: string): Promise<SettingValues>;
    setSetting(moduleId: string, id: string, value: SettingValue): Promise<void>;
    onSettingsChanged(cb: (moduleId: string, values: SettingValues) => void): Unsubscribe;
    snapshot(): Promise<ContributionSnapshot>;
    onChanged(cb: (snapshot: ContributionSnapshot) => void): Unsubscribe;
    grammar(languageId: string): Promise<unknown | null>;
    grammarByScope(scopeName: string): Promise<unknown | null>;
    runCommand(id: string): Promise<void>;
    treeChildren(panelId: string, parentId: string | null): Promise<TreeItem[]>;
    /** Runs one of a tree item's right-click actions in its module. */
    treeAction(panelId: string, actionId: string, item: TreeItem): Promise<void>;
    /** A module asked to reload its tree; `itemId` limits it to that item's children. */
    onTreeRefresh(cb: (panelId: string, itemId?: string) => void): Unsubscribe;
    renderPreview(id: string, text: string, path: string): Promise<string>;
    templateFile(id: string, name: string, dir: string): Promise<{ fileName: string | null; content: string }>;
    complete(req: CompletionRequest): Promise<CompletionItem[]>;
    /** Hover text from the language server at a position, or null. */
    hover(req: CompletionRequest): Promise<string | null>;
    /** Where the symbol at a position is defined, or null. */
    definition(req: CompletionRequest): Promise<SourceLocation | null>;
    /** Sends an open file's text to its language server (so it can publish diagnostics). */
    syncDocument(req: { path: string; languageId: string; text: string }): Promise<void>;
    closeDocument(req: { path: string; languageId: string }): Promise<void>;
    /** Diagnostics a language server published for a file (replacing earlier ones for it). */
    onDiagnostics(cb: (path: string, diagnostics: Diagnostic[]) => void): Unsubscribe;
    onOpenFile(cb: (path: string, line?: number, column?: number) => void): Unsubscribe;
    /** Messages from modules (and extension host problems) for the status bar. */
    onMessage(cb: (message: ModuleMessage) => void): Unsubscribe;
  };
  app: {
    /** Versions, OS and storage folders, for About → Diagnostics. */
    info(): Promise<AppInfo>;
    /** Opens one of the folders listed in `info()` in Finder / Explorer. */
    openFolder(id: AppFolder): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    /** Saves a change; rejects with a reason if a value isn't allowed (e.g. a non-https marketplace URL). */
    update(change: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(cb: (settings: AppSettings) => void): Unsubscribe;
  };
  marketplace: {
    /** Fetches the GitHub-hosted index; rejects if it can't be reached within 5 seconds. */
    index(): Promise<MarketplaceIndex>;
    /** Downloads, verifies and installs an entry from the last fetched index. */
    installLanguage(id: string): Promise<void>;
    installTheme(id: string): Promise<void>;
  };
  projects: {
    recent(): Promise<RecentProject[]>;
    openDialog(): Promise<void>;
    openPath(path: string): Promise<'opened' | 'missing'>;
    removeRecent(path: string): Promise<void>;
    pickFolder(): Promise<string | null>;
    pickFile(): Promise<string | null>;
    create(req: NewProjectRequest): Promise<void>;
    defaultParentDir(): Promise<string>;
  };
  themes: {
    list(): Promise<ThemeSummary[]>;
    active(): Promise<Theme>;
    setActive(id: string): Promise<void>;
    /** The user's Light/Dark choice; the active theme uses that variant when it has one. */
    mode(): Promise<ThemeMode>;
    /** Choosing Light or Dark turns Sync with OS off. */
    setMode(mode: ThemeMode): Promise<void>;
    /** Whether the mode follows the OS's light/dark setting. */
    syncWithOs(): Promise<boolean>;
    setSyncWithOs(on: boolean): Promise<void>;
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
    /** Renames in place; resolves to the new path. */
    rename(path: string, newName: string): Promise<string>;
    /** Confirms with the user, then moves to the Trash; false if they cancelled. */
    trash(path: string): Promise<boolean>;
    /** Shows the file or folder in Finder / Explorer. */
    reveal(path: string): Promise<void>;
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
