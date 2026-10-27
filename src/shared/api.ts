import type {
  AppFolder, AppInfo, AppSettings, DebugState, DebugVariable, DirEntry, GitCommit, GitRemote, GitStash, GitStatus, GitTag, WorkingDiff, UpdateStatus, FileReadResult, LayoutState, NewProjectRequest, RecentProject,
  RunEntry, Theme, ThemeMode, ThemeSummary, Unsubscribe, WindowKind,
} from './types';
import type {
  AppNotification, CompletionItem, CompletionRequest, ContributionSnapshot, Diagnostic, DocumentRequest, DocumentSymbol, FileEdits, ModuleMessage,
  ModuleSummary, ReferenceLocation, SettingValue, SettingValues, SignatureHelp, SourceLocation, TextEdit, TreeItem,
} from './modules';
import type { MarketplaceEntry, MarketplaceKind } from './marketplace';

export const CHANNEL_PREFIX = 'saturn:';

/** Builds an IPC channel name, e.g. channel('themes', 'setActive') → 'saturn:themes.setActive'. */
export function channel(area: string, name: string): string {
  return `${CHANNEL_PREFIX}${area}.${name}`;
}

/** Listing, installing from a folder or zip and removing one kind of code module. */
interface InstallableModules {
  list(): Promise<ModuleSummary[]>;
  /** Asks for a folder (the default) or a .zip file and installs what's in it; null if cancelled. */
  installDialog(source?: 'folder' | 'zip'): Promise<ModuleSummary | null>;
  uninstall(id: string): Promise<void>;
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
    /** Opens Settings, optionally on a section ("appearance", or a module's tab as "module:<id>"). */
    openSettings(section?: string): void;
    openNewProject(): void;
    /** Shows the Welcome window (Saturn's home: projects, New, Open, Clone), opening it if it's closed. */
    openWelcome(): void;
    openMarketplace(section?: 'themes' | 'languages' | 'extensions'): void;
  };
  /** Installed languages, and what they do in the editor (highlighting and language servers). */
  languages: InstallableModules & {
    grammar(languageId: string): Promise<unknown | null>;
    grammarByScope(scopeName: string): Promise<unknown | null>;
    complete(req: CompletionRequest): Promise<CompletionItem[]>;
    /** Hover text from the language server at a position, or null. */
    hover(req: CompletionRequest): Promise<string | null>;
    /** Where the symbol at a position is defined, or null. */
    definition(req: CompletionRequest): Promise<SourceLocation | null>;
    /** Everything defined in a file, nested, for the Outline panel. */
    symbols(req: DocumentRequest): Promise<DocumentSymbol[]>;
    /** Every usage of the symbol at a position, declaration included. */
    references(req: CompletionRequest): Promise<ReferenceLocation[]>;
    /** The edits that rename the symbol at a position across the project; rejects with the server's reason if it can't. */
    rename(req: CompletionRequest & { newName: string }): Promise<FileEdits[]>;
    /** Edits that format the whole file. */
    format(req: DocumentRequest & { tabSize: number; insertSpaces: boolean }): Promise<TextEdit[]>;
    /** Parameter hints for the call around a position, or null. */
    signatureHelp(req: CompletionRequest): Promise<SignatureHelp | null>;
    /** Sends an open file's text to its language server (so it can publish diagnostics). */
    syncDocument(req: { path: string; languageId: string; text: string }): Promise<void>;
    closeDocument(req: { path: string; languageId: string }): Promise<void>;
    /** Diagnostics a language server published for a file (replacing earlier ones for it). */
    onDiagnostics(cb: (path: string, diagnostics: Diagnostic[]) => void): Unsubscribe;
  };
  /** Installed extensions: actions, scripts, panels, buttons and settings, but no languages. */
  extensions: InstallableModules;
  /** What languages and extensions share at runtime. */
  modules: {
    setEnabled(id: string, enabled: boolean): Promise<void>;
    /** A module's contributed settings, with defaults filled in. */
    settings(moduleId: string): Promise<SettingValues>;
    setSetting(moduleId: string, id: string, value: SettingValue): Promise<void>;
    onSettingsChanged(cb: (moduleId: string, values: SettingValues) => void): Unsubscribe;
    snapshot(): Promise<ContributionSnapshot>;
    onChanged(cb: (snapshot: ContributionSnapshot) => void): Unsubscribe;
    runCommand(id: string): Promise<void>;
    treeChildren(panelId: string, parentId: string | null): Promise<TreeItem[]>;
    /** Runs one of a tree item's right-click actions in its module. */
    treeAction(panelId: string, actionId: string, item: TreeItem): Promise<void>;
    /** A module asked to reload its tree; `itemId` limits it to that item's children. */
    onTreeRefresh(cb: (panelId: string, itemId?: string) => void): Unsubscribe;
    renderPreview(id: string, text: string, path: string): Promise<string>;
    templateFile(id: string, name: string, dir: string): Promise<{ fileName: string | null; content: string }>;
    onOpenFile(cb: (path: string, line?: number, column?: number) => void): Unsubscribe;
    /** A module asked to run a command in a new Terminal tab (`saturn.terminal.run`). */
    onRunInTerminal(cb: (name: string, command: string) => void): Unsubscribe;
    /** Messages from modules (and extension host problems) for the status bar. */
    onMessage(cb: (message: ModuleMessage) => void): Unsubscribe;
  };
  /** The bell menu next to Settings: notifications from modules and Saturn, newest first. */
  notifications: {
    list(): Promise<AppNotification[]>;
    dismiss(id: string): Promise<void>;
    clear(): Promise<void>;
    markAllRead(): Promise<void>;
    /** Runs a notification's action by its index (command, open Settings tab, or https link). */
    act(id: string, index: number): Promise<void>;
    onChanged(cb: (items: AppNotification[]) => void): Unsubscribe;
  };
  /** Debugging this project (through a language module's debugger) and its breakpoints. */
  debug: {
    state(): Promise<DebugState>;
    /** File path → 1-based breakpoint lines. */
    breakpoints(): Promise<Record<string, number[]>>;
    setBreakpoints(path: string, lines: number[]): Promise<void>;
    /** Debugs a file with its language's debugger; rejects if the language has none. */
    start(req: { path: string; languageId: string }): Promise<void>;
    stop(): Promise<void>;
    continue(): Promise<void>;
    /** Step over. */
    next(): Promise<void>;
    stepIn(): Promise<void>;
    stepOut(): Promise<void>;
    pause(): Promise<void>;
    selectFrame(frameId: number): Promise<void>;
    /** A variable's children. */
    variables(ref: number): Promise<DebugVariable[]>;
    /** Evaluates an expression in the selected frame. */
    evaluate(expression: string): Promise<string>;
    onChanged(cb: (state: DebugState) => void): Unsubscribe;
    /** Program and debugger output; `category` is the DAP one ("stdout", "stderr", "console"…). */
    onOutput(cb: (text: string, category: string) => void): Unsubscribe;
  };
  /** Saturn's own updates from GitHub Releases. */
  updates: {
    status(): Promise<UpdateStatus>;
    /** Looks for a new release now (it downloads in the background if there is one). */
    check(): Promise<UpdateStatus>;
    /** Restarts Saturn to install a downloaded update, or (unsigned macOS) opens the new version's download page. */
    install(): Promise<void>;
    onChanged(cb: (status: UpdateStatus) => void): Unsubscribe;
  };
  /** The editor window's project repository, via the system `git`. */
  git: {
    status(): Promise<GitStatus>;
    /** History of the current branch, or of `ref` (a branch or tag). */
    log(ref?: string): Promise<GitCommit[]>;
    show(hash: string): Promise<{ message: string; files: { status: string; path: string }[] }>;
    branches(): Promise<string[]>;
    init(): Promise<void>;
    stage(paths: string[]): Promise<void>;
    unstage(paths: string[]): Promise<void>;
    commit(message: string): Promise<void>;
    /** Switches branch; uncommitted changes come along ("bring") or are shelved for the branch being left ("shelve", the default). */
    checkout(branch: string, mode?: 'bring' | 'shelve'): Promise<void>;
    createBranch(name: string): Promise<void>;
    push(): Promise<void>;
    pull(): Promise<void>;
    /** A file's uncommitted changes as a unified diff, or its changes in commit `hash`. */
    diff(path: string, hash?: string): Promise<string>;
    /** Deletes a local branch; `force` also deletes one with unmerged commits. */
    deleteBranch(name: string, force?: boolean): Promise<void>;
    renameBranch(from: string, to: string): Promise<void>;
    /** Remote-tracking branches, e.g. "origin/main". */
    remoteBranches(): Promise<string[]>;
    /** Merges a branch into the current one; rejects saying so if it stops on conflicts. */
    merge(name: string): Promise<void>;
    /** Aborts the stopped merge, rebase, cherry-pick or revert. */
    abortOperation(): Promise<void>;
    /** Continues it once conflicts are resolved (commits a merge). */
    continueOperation(): Promise<void>;
    /** Replays the current branch's commits onto another branch. */
    rebase(onto: string): Promise<void>;
    cherryPick(hash: string): Promise<void>;
    /** Commits the inverse of a commit. */
    revert(hash: string): Promise<void>;
    tags(): Promise<GitTag[]>;
    /** Tags a commit (HEAD when not given); a message makes it annotated. */
    createTag(name: string, hash?: string, message?: string): Promise<void>;
    deleteTag(name: string): Promise<void>;
    /** Re-tags the same commit under a new name and deletes the old tag (local only). */
    renameTag(from: string, to: string): Promise<void>;
    pushTags(): Promise<void>;
    /** A file's uncommitted changes split into staged and unstaged diffs. */
    workingDiff(path: string): Promise<WorkingDiff>;
    /** Stages (or unstages) one hunk, given as a patch with its file header. */
    applyHunk(patch: string, unstage: boolean): Promise<void>;
    /** Resolves a conflicted file by taking one side, then stages it. */
    resolveWith(path: string, side: 'ours' | 'theirs'): Promise<void>;
    stashes(): Promise<GitStash[]>;
    /** Stashes every change (untracked files included). */
    stash(message: string): Promise<void>;
    /** Applies a stash; `pop` also removes it. */
    applyStash(ref: string, pop: boolean): Promise<void>;
    dropStash(ref: string): Promise<void>;
    remotes(): Promise<GitRemote[]>;
    addRemote(name: string, url: string): Promise<void>;
    removeRemote(name: string): Promise<void>;
    /** Pushes the current branch to a remote and makes it the upstream. */
    pushTo(remote: string): Promise<void>;
    /** Answers a credential prompt (null cancels). */
    answerCredential(id: string, answer: string | null): Promise<void>;
    /** Git needs a username, password or token (e.g. to push); answer with `answerCredential`. */
    onCredentialPrompt(cb: (id: string, prompt: string, secret: boolean) => void): Unsubscribe;
    /** Saturn changed the repository (commit, stage, branch…); file changes come through `fs.onChanged`. */
    onChanged(cb: () => void): Unsubscribe;
  };
  app: {
    /** Versions, OS and storage folders, for About → Diagnostics. */
    info(): Promise<AppInfo>;
    /** Opens one of the folders listed in `info()` in Finder / Explorer. */
    openFolder(id: AppFolder): Promise<void>;
    /** Asks for confirmation, then wipes Saturn's data and restarts it as new; false if cancelled. */
    reset(): Promise<boolean>;
  };
  settings: {
    get(): Promise<AppSettings>;
    /** Saves a change; rejects with a reason if a value isn't allowed (e.g. a non-https marketplace URL). */
    update(change: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(cb: (settings: AppSettings) => void): Unsubscribe;
  };
  marketplace: {
    /** Fetches one kind's list from the GitHub-hosted index; rejects if it can't be reached within 5 seconds. */
    list(kind: MarketplaceKind): Promise<MarketplaceEntry[]>;
    /** Downloads, verifies and installs an entry (the newest version this Saturn supports) from the last fetched list. */
    installLanguage(id: string): Promise<void>;
    installExtension(id: string): Promise<void>;
    installTheme(id: string): Promise<void>;
  };
  projects: {
    recent(): Promise<RecentProject[]>;
    openDialog(): Promise<void>;
    openPath(path: string): Promise<'opened' | 'missing'>;
    removeRecent(path: string): Promise<void>;
    pickFolder(): Promise<string | null>;
    pickFile(): Promise<string | null>;
    /** Clones a repository into a new folder inside `parentDir`, then opens it. */
    clone(url: string, parentDir: string): Promise<void>;
    /** Creates the folder, runs the language's onCreate (folder removed if it fails), then opens it. */
    create(req: NewProjectRequest): Promise<void>;
    /** Progress messages from the language's onCreate while `create` runs. */
    onCreateProgress(cb: (message: string) => void): Unsubscribe;
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
    /** Asks for a folder (the default) or a .zip file containing theme.json and installs it; null if cancelled. */
    installDialog(source?: 'folder' | 'zip'): Promise<ThemeSummary | null>;
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
