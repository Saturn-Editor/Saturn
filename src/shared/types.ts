import type { CustomKeymap, KeymapChoice } from './keymaps';

export type WindowKind = 'welcome' | 'editor' | 'settings' | 'new-project' | 'marketplace' | 'onboarding';

export const THEME_TOKENS = [
  'app', 'editor', 'panel', 'raised', 'divider', 'border', 'text',
  'strong', 'muted', 'accent', 'on-accent', 'selection', 'hover',
] as const;
export type ThemeTokens = (typeof THEME_TOKENS)[number];

export interface SyntaxRule {
  scope: string;
  /** Leave out to keep the surrounding colour and only apply `fontStyle`. */
  color?: string;
  /** Any of "bold", "italic", "underline", "strikethrough", space-separated (as in VS Code themes). */
  fontStyle?: string;
}

/** One changed file from `git status`: X (staged) and Y (working tree) letters, e.g. "M", "A", "?" for untracked. */
export interface GitChange {
  path: string;
  index: string;
  worktree: string;
}

export interface GitStatus {
  /** False when the project isn't a Git repository. */
  repo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  /** A merge, rebase, cherry-pick or revert that stopped (usually on conflicts) and is waiting to be continued or aborted. */
  operation: GitOperation | null;
  /** Files with unresolved conflicts. */
  conflicts: string[];
}

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export interface GitTag {
  name: string;
  /** The commit it points at (short hash). */
  commit: string;
  /** An annotated tag's message, else empty. */
  message: string;
}

/** A file's uncommitted changes, split by what's staged (index vs last commit) and what isn't (working tree vs index). */
export interface WorkingDiff {
  staged: string;
  unstaged: string;
  /** New, untracked file: its whole content shows as unstaged and hunks can't be staged separately. */
  untracked: boolean;
}

/** A saved stash. `shelf` is the branch a branch switch shelved it for, else null. */
export interface GitStash {
  ref: string;
  branch: string | null;
  message: string;
  /** ISO date. */
  date: string;
  shelf: string | null;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  /** ISO date. */
  date: string;
  subject: string;
  /** Branch and tag names pointing at it, e.g. "HEAD -> main", "origin/main". */
  refs: string[];
}

/**
 * Saturn's own updates (from GitHub Releases); "unavailable" in development builds. "available" means
 * a new version exists but must be downloaded by hand (an unsigned macOS build can't install updates).
 */
export interface UpdateStatus {
  state: 'unavailable' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  message?: string;
  /** For "available": the release page to download it from. */
  downloadUrl?: string;
}

/** A stack frame of the paused program; `line` and `column` are 1-based, `path` null for code without a file. */
export interface DebugFrame {
  id: number;
  name: string;
  path: string | null;
  line: number;
  column: number;
}

/** A variable's name and value; `ref` is non-zero when it has children (fetched with `debug.variables`). */
export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  ref: number;
}

export interface DebugScope {
  name: string;
  variables: DebugVariable[];
}

/** The project's debug session: nothing, starting, running, or paused with its stack and the selected frame's variables. */
export interface DebugState {
  state: 'idle' | 'starting' | 'running' | 'stopped';
  /** What's being debugged, e.g. "Program.cs (.NET Core)". */
  name?: string;
  /** Why it paused, e.g. "breakpoint", "step", "exception". */
  reason?: string;
  frames: DebugFrame[];
  frameId?: number;
  scopes: DebugScope[];
}

/** Version and environment details for About → Diagnostics. */
export interface AppInfo {
  version: string;
  saturnApi: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  /** e.g. "macOS 26.0 (arm64)". */
  os: string;
  locale: string;
  folders: { id: AppFolder; label: string; path: string }[];
}

/** Folders About can open: where Saturn is installed, and where it keeps settings, languages and themes. */
export type AppFolder = 'install' | 'userData' | 'languages' | 'extensions' | 'themes';

/** Settings the user edits in the Settings window (theme and mode have their own API). */
export interface AppSettings {
  /** Language-server completion while typing. */
  completion: boolean;
  /** Errors and warnings from language servers, underlined in the editor with gutter markers. */
  diagnostics: boolean;
  /** Which set of keyboard shortcuts to use: a built-in keymap, or "custom:<id>". */
  keymap: KeymapChoice;
  /** The user's own keymaps (Settings → Keymap → Duplicate). */
  customKeymaps: CustomKeymap[];
  /** Typing an opening bracket or quote also inserts the closer. */
  autoCloseBrackets: boolean;
  /** Switching branches with uncommitted changes: ask each time, bring them to the new branch, or shelve them for the old one. */
  branchSwitch: BranchSwitchMode;
  /** Saving a file (Save File) formats it first with its language server, where the language supports it. */
  formatOnSave: boolean;
  /** Interface and editor text size as a percentage (100 is the default); scales every window. */
  textSize: number;
  /** How files are read and saved. */
  encoding: FileEncoding;
  /** Look for updates at launch and every few hours: Saturn's own (packaged builds only), and installed languages, extensions and themes. */
  autoUpdate: boolean;
  /** "typing": every 2s while there are changes; "idle": once typing stops, and on closing a tab or leaving the window; "off". */
  autoSave: 'typing' | 'idle' | 'off';
  /** Enter keeps the current line's indentation (and the language's extra indent). */
  autoIndent: boolean;
  /** What Tab and auto-indent insert. */
  indentWith: 'spaces' | 'tab';
  /** Spaces per indent level when indenting with spaces. */
  indentSize: 2 | 4 | 8;
  /** The user's choice of how files with a preview open (code, split or preview), by preview id. */
  defaultViews: Record<string, 'code' | 'split' | 'preview'>;
  /** The marketplace index URL; the official one unless the user changed it. */
  marketplaceUrl: string;
}

export type BranchSwitchMode = 'ask' | 'bring' | 'shelve';

export type FileEncoding = 'utf-8' | 'utf-16' | 'us-ascii' | 'iso-8859-1';

/** Settings → Editor → Encoding choices, as shown. UTF-16 is little-endian with a byte-order mark. */
export const FILE_ENCODINGS: { id: FileEncoding; label: string }[] = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-16', label: 'UTF-16' },
  { id: 'us-ascii', label: 'US-ASCII' },
  { id: 'iso-8859-1', label: 'ISO-8859-1' },
];

/** Choices for Appearance → Text size, as percentages. */
export const TEXT_SIZES = [80, 90, 100, 110, 125, 150] as const;

export type ThemeMode = 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark'];

export interface ThemeVariant {
  colors: Record<ThemeTokens, string>;
  syntax: SyntaxRule[];
}

/** A theme.json file: one theme with a light and/or a dark variant (at least one). */
export type ThemeFile = { id: string; name: string; version?: string; description?: string } & Partial<Record<ThemeMode, ThemeVariant>>;

/** The active theme resolved to one variant: the user's Light/Dark mode, or the only variant it has. */
export interface Theme extends ThemeVariant {
  id: string;
  name: string;
  type: ThemeMode;
}

export interface ThemeSummary {
  id: string;
  name: string;
  version: string | null;
  description: string;
  /** Its icon.svg / icon.png as a saturn-icon:// URL, or null (built-in themes, or none shipped). */
  icon: string | null;
  /** Which variants the theme has. */
  modes: ThemeMode[];
  builtIn: boolean;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
  /** Languages in the project, main one first (e.g. ["php", "javascript"]); empty for plain text. */
  languageIds: string[];
  missing: boolean;
}

export interface NewProjectRequest {
  name: string;
  parentDir: string;
  gitInit: boolean;
  /** null for Plain Text; otherwise the language whose module fills the new folder in. */
  languageId: string | null;
  /** Values of the language's New Project fields, by field id. */
  fields: Record<string, string | boolean>;
  /** Open the new project in place of this one: its window closes (with the usual unsaved-changes prompt). */
  replaceProject?: string;
}

export type DockId = 'left' | 'bottom';

export interface DockState {
  panels: string[];
  active: string | null;
  size: number;
  open: boolean;
}

export interface LayoutState {
  docks: Record<DockId, DockState>;
}

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
}

export type FileReadResult =
  | { kind: 'text'; text: string; eol: 'LF' | 'CRLF' }
  | { kind: 'binary' }
  | { kind: 'too-large'; bytes: number };

export interface RunEntry {
  id: string;
  name: string;
  command: string;
  /** 'custom' for the user's own commands, otherwise the module id that suggested it. */
  source: 'custom' | string;
  /** Menu heading, e.g. "Custom" or the language's name. */
  group: string;
}

export type Unsubscribe = () => void;
