export type WindowKind = 'welcome' | 'editor' | 'settings' | 'new-project' | 'marketplace';

export const THEME_TOKENS = [
  'app', 'editor', 'panel', 'raised', 'divider', 'border', 'text',
  'strong', 'muted', 'accent', 'on-accent', 'selection', 'hover',
] as const;
export type ThemeTokens = (typeof THEME_TOKENS)[number];

export interface SyntaxRule {
  scope: string;
  color: string;
  fontStyle?: 'bold' | 'italic';
}

export interface Theme {
  id: string;
  name: string;
  type: 'light' | 'dark';
  colors: Record<ThemeTokens, string>;
  syntax: SyntaxRule[];
}

export interface ThemeSummary {
  id: string;
  name: string;
  type: 'light' | 'dark';
  builtIn: boolean;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
  languageId: string | null;
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
