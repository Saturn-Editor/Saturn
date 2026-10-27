import type { KeymapId } from './keymaps';

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
export type AppFolder = 'install' | 'userData' | 'modules' | 'themes';

/** Settings the user edits in the Settings window (theme and mode have their own API). */
export interface AppSettings {
  /** Language-server completion while typing. */
  completion: boolean;
  /** Which set of keyboard shortcuts to use. */
  keymap: KeymapId;
  /** Interface and editor text size as a percentage (100 is the default); scales every window. */
  textSize: number;
  /** The marketplace index URL; the official one unless the user changed it. */
  marketplaceUrl: string;
}

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
