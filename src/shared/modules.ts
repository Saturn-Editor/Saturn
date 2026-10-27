/** The module API version this build of Saturn implements. Modules declare a compatible range in `saturnApi`. */
export const SATURN_API_VERSION = '0.2.0';

export interface ManifestLanguage {
  id: string;
  name: string;
  extensions: string[];
  /** Path to a TextMate grammar (JSON), relative to the module folder. */
  grammar?: string;
  /** TextMate scope name of the grammar, e.g. "text.html.markdown". */
  scopeName?: string;
}

export interface ManifestLanguageServer {
  languages: string[];
  /** "node" means Saturn's bundled runtime; anything else is resolved from PATH. */
  command: string;
  /** "${setting:<id>}" in the command or an argument is replaced by that module setting's value. */
  args?: string[];
}

export interface ManifestPanel {
  id: string;
  title: string;
  dock: 'left' | 'bottom';
  /** Its icon: an .svg or .png file at the module folder root, e.g. "panel-icon.svg". Defaults to the module's icon, then "?". */
  icon?: string;
}

export interface ManifestCommand {
  id: string;
  title: string;
}

export interface ManifestPreview {
  id: string;
  label: string;
  extensions: string[];
}

export interface ManifestFileTemplate {
  id: string;
  label: string;
  kind: 'file' | 'dir';
  extension?: string;
  placeholder?: string;
}

export type NewProjectFieldType = 'text' | 'select' | 'checkbox' | 'folder' | 'file';

export interface NewProjectField {
  id: string;
  label: string;
  type: NewProjectFieldType;
  default?: string | boolean;
  options?: { value: string; label: string }[];
}

export interface ManifestNewProject {
  /** The language the project is created as (shown in the New Project sidebar). */
  language: string;
  fields: NewProjectField[];
}

/**
 * A setting a module adds to its own tab in Settings, e.g. Java's JAR location. Same field types
 * as New Project. Ids are local to the module ("jarPath").
 */
export interface ManifestSetting extends NewProjectField {
  description?: string;
}

export type SettingValue = string | boolean;
export type SettingValues = Record<string, SettingValue>;

/** Each setting's stored value, or its default (false for checkboxes, the first option for selects, else ""). */
export function settingDefaults(fields: NewProjectField[]): SettingValues {
  return Object.fromEntries(fields.map((f) => [f.id, f.default ?? (f.type === 'checkbox' ? false : (f.options?.[0]?.value ?? ''))]));
}

/**
 * Code modules are the two installable kinds that run code in the extension host: languages
 * (highlighting, language servers, previews, templates, project types) and extensions (actions,
 * scripts, panels, buttons and settings, but no languages).
 */
export type ModuleKind = 'language' | 'extension';

export const MANIFEST_FILES: Record<ModuleKind, string> = { language: 'saturn-language.json', extension: 'saturn-extension.json' };

/** An installed language's, extension's or theme's picture, at its folder root: the SVG if present, else the PNG. */
export const ICON_FILES = ['icon.svg', 'icon.png'];
/** Windows load those pictures as saturn-icon://module/<id> or saturn-icon://theme/<id>. */
export const ICON_SCHEME = 'saturn-icon';

/** A button on the editor's right-hand bar (below Settings); clicking it runs the command. */
export interface ManifestButton {
  /** A command the module registers with `saturn.commands.register`. */
  command: string;
  title: string;
  /** Its icon: an .svg or .png file at the module folder root, e.g. "chat-icon.svg". Defaults to the module's icon, then "?". */
  icon?: string;
}

/** A panel's or button's own icon file: an .svg or .png path inside the module folder, e.g. "icons/build.svg" (no "..", not absolute). */
export const ICON_FILE_NAME = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(svg|png)$/i;

/** What both kinds of manifest share. */
interface CodeModuleManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Short text used as the module's icon, e.g. "MD", "C#". */
  badge?: string;
  saturnApi: string;
  /** Entry point (ES module exporting `activate(saturn)`), relative to the module folder. */
  main?: string;
  activationEvents?: string[];
  /** External tools the module needs; checked before its language server starts. */
  requires?: ManifestRequirement[];
}

interface CommonContributions {
  panels?: ManifestPanel[];
  commands?: ManifestCommand[];
  runConfigurations?: boolean;
  settings?: ManifestSetting[];
  buttons?: ManifestButton[];
}

/** saturn-language.json */
export interface LanguageManifest extends CodeModuleManifest {
  contributes?: CommonContributions & {
    languages?: ManifestLanguage[];
    languageServer?: ManifestLanguageServer;
    previews?: ManifestPreview[];
    fileTemplates?: ManifestFileTemplate[];
    newProject?: ManifestNewProject;
  };
}

/** saturn-extension.json: actions, scripts, panels, buttons and settings, but no languages. */
export interface ExtensionManifest extends CodeModuleManifest {
  contributes?: CommonContributions;
}

export type ModuleManifest = LanguageManifest | ExtensionManifest;

export interface ModuleSummary {
  kind: ModuleKind;
  id: string;
  name: string;
  version: string;
  description: string;
  badge: string;
  /** Its icon.svg / icon.png as a saturn-icon:// URL, or null to show `badge`. */
  icon: string | null;
  enabled: boolean;
  /** Null when compatible; otherwise why the module can't load. */
  incompatible: string | null;
  /** File extensions a language handles (empty for extensions). */
  languages: string[];
}

/** Everything enabled modules contribute, as sent to each window. */
/** How a module is pictured: its icon (a saturn-icon:// URL) when it ships one, else its badge text. */
export interface ModuleLook {
  badge: string;
  icon: string | null;
}

export interface ContributionSnapshot {
  languages: (ManifestLanguage & ModuleLook & { moduleId: string; hasServer: boolean })[];
  /** `iconUrl` is the panel's own icon file, else the module's icon, else null (shown as "?"). */
  panels: (ManifestPanel & { moduleId: string; iconUrl: string | null })[];
  commands: (ManifestCommand & ModuleLook & { moduleId: string; moduleName: string })[];
  previews: (ManifestPreview & { moduleId: string })[];
  fileTemplates: (ManifestFileTemplate & { moduleId: string })[];
  newProject: (ManifestNewProject & ModuleLook & { moduleId: string; languageName: string })[];
  /** One Settings tab per module that declares settings. */
  settings: (ModuleLook & { moduleId: string; moduleName: string; items: ManifestSetting[] })[];
  /** Buttons on the editor's right-hand bar; `iconUrl` as for panels. */
  buttons: (ManifestButton & { moduleId: string; iconUrl: string | null })[];
}

export type MessageKind = 'info' | 'warning' | 'error';

/** A button on a notification: run one of the module's commands, open its Settings tab, or open an https link. */
export interface NotificationAction {
  label: string;
  command?: string;
  openSettings?: boolean;
  url?: string;
}

/** An entry in the editor's notifications menu (the bell next to Settings). */
export interface AppNotification {
  id: string;
  /** The module that sent it, or "saturn". */
  moduleId: string;
  title: string;
  message: string;
  kind: MessageKind;
  actions: NotificationAction[];
  /** When it arrived (ms since epoch). */
  time: number;
  read: boolean;
}

/** A message a module shows the user (in the editor window's status bar). */
export interface ModuleMessage {
  message: string;
  kind: MessageKind;
  /** Which project's window; every window when absent. */
  projectPath?: string;
  moduleId: string;
}

export interface TreeItem {
  id: string;
  label: string;
  hasChildren: boolean;
  /** Clicking the item opens this file (project-relative or absolute), at a 1-based line and column. Works on items with children too; their chevron expands them. */
  open?: { path: string; line?: number; column?: number };
  /** Short text shown as the item's icon, e.g. "C#", "{}", "M". */
  badge?: string;
  /** Muted text after the label, e.g. a package version or member type. */
  description?: string;
  /** Shown on hover, e.g. a full signature. */
  tooltip?: string;
  /** Right-click actions; picking one calls the tree provider's `onAction`. */
  actions?: { id: string; label: string }[];
}

/** A span in a document, 0-based like LSP. */
export interface TextRange {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
}

export interface CompletionItem {
  label: string;
  detail?: string;
  insertText?: string;
  kind?: number;
  /** The span the server wants replaced (its `textEdit.range`); otherwise Saturn replaces the word before the cursor. */
  range?: TextRange;
  /** `insertText` uses snippet syntax ($1, ${1:name}, $0), i.e. LSP insertTextFormat 2. */
  snippet?: boolean;
}

/** A position in a document plus its current text, for completion, hover and go to definition. */
export interface CompletionRequest {
  path: string;
  languageId: string;
  text: string;
  line: number;
  character: number;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/** An error or warning from a language server (LSP publishDiagnostics). */
export interface Diagnostic extends TextRange {
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
}

/** Where go to definition leads: an absolute path and 1-based line and column. */
export interface SourceLocation {
  path: string;
  line: number;
  column: number;
}

/**
 * An external tool a module needs, e.g. the .NET SDK. Saturn runs `command args` before starting the
 * module's language server; if that fails it tells the user `name` is missing, with `install`.
 */
export interface ManifestRequirement {
  name: string;
  command: string;
  args?: string[];
  /** How to get it, e.g. "Install the .NET 8 SDK from https://dot.net". */
  install?: string;
}

/** Is `version` within a caret range like "^0.1" or "^1.2.0"? Major 0 ranges also pin the minor. */
export function satisfiesCaret(range: string, version: string): boolean {
  const match = /^\^?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range.trim());
  if (!match) return false;
  const [maj, min = 0, pat = 0] = match.slice(1).map((n) => Number(n ?? 0));
  const [vMaj, vMin, vPat] = version.split('.').map(Number);
  if (vMaj !== maj) return false;
  if (maj === 0 && vMin !== min) return false;
  return vMin > min || (vMin === min && vPat >= pat);
}
