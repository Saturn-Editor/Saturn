import { saturnApi } from '../../package.json';

export const SATURN_API_VERSION = saturnApi;

export interface ManifestLanguage {
  id: string;
  name: string;
  extensions: string[];
  /** Path to a TextMate grammar (JSON), relative to the module folder. */
  grammar?: string;
  /** TextMate scope name of the grammar, e.g. "text.html.markdown". */
  scopeName?: string;
  /** The module offers versions (e.g. JDKs) through saturn.languages.registerVersions; clicking the language in the status bar picks one per project. */
  versions?: boolean;
}

export type LanguageFeature =
  | 'completion' | 'diagnostics' | 'hover' | 'definition' | 'symbols' | 'references' | 'rename' | 'formatting' | 'signatureHelp';

export const LANGUAGE_FEATURES: { id: LanguageFeature; label: string }[] = [
  { id: 'completion', label: 'Code completion' },
  { id: 'diagnostics', label: 'Error checking' },
  { id: 'hover', label: 'Hover information' },
  { id: 'definition', label: 'Go to definition' },
  { id: 'symbols', label: 'Outline' },
  { id: 'references', label: 'Find usages' },
  { id: 'rename', label: 'Rename' },
  { id: 'formatting', label: 'Formatting' },
  { id: 'signatureHelp', label: 'Parameter hints' },
];

/** The module setting key holding a language feature's on/off switch (true unless turned off). */
export function featureKey(feature: LanguageFeature): string {
  return `feature:${feature}`;
}

export interface ManifestLanguageServer {
  languages: string[];
  /** "node" means Saturn's bundled runtime; anything else is resolved from PATH. */
  command: string;
  /** "${setting:<id>}" in the command or an argument is replaced by that module setting's value. */
  args?: string[];
  /** What the server supports; each gets an on/off switch in the language's Settings tab. All of them when left out. */
  features?: LanguageFeature[];
}

/**
 * A debugger (a Debug Adapter Protocol adapter speaking over stdio). Start Debugging runs it for a
 * file in one of `languages` and sends `launch` as the DAP launch arguments.
 */
export interface ManifestDebugger {
  /** Shown in the Debug panel, e.g. ".NET Core". */
  label: string;
  languages: string[];
  /** As for language servers: "node" is Saturn's runtime; "${setting:<id>}" is replaced. */
  command: string;
  args?: string[];
  /**
   * DAP launch arguments. In string values, "${file}" is the file being debugged, "${project}" the
   * project folder, and "${setting:<id>}" a module setting.
   */
  launch: Record<string, unknown>;
  /** More launch arguments to choose from in the Debug panel, e.g. "Tests" or "With arguments"; `launch` is the default. */
  configurations?: { id: string; label: string; launch: Record<string, unknown> }[];
  /** DAP attach arguments, for attaching to a running process; "${processId}" is the chosen process's id. */
  attach?: Record<string, unknown>;
}

export interface ManifestPanel {
  id: string;
  title: string;
  dock: 'left' | 'bottom';
  /**
   * "tree" (the default) is drawn by Saturn from `saturn.panels.registerTree`; "webview" shows the
   * module's own HTML from `saturn.webviews.register`, which can message the module back.
   */
  kind?: 'tree' | 'webview';
  /** Its icon: an .svg or .png file at the module folder root, e.g. "panel-icon.svg". Defaults to the module's icon, then "?". */
  icon?: string;
}

export interface ManifestCommand {
  id: string;
  title: string;
}

export type ViewMode = 'code' | 'split' | 'preview';

export interface ManifestPreview {
  id: string;
  label: string;
  extensions: string[];
  /** How these files open: code only (the default), code and preview side by side, or preview only. The user can change it. */
  defaultView?: ViewMode;
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
  /**
   * New Project only: show (and send) the field only for these templates and/or tabs, e.g.
   * { "template": ["console"] }. Both lists must match when both are given.
   */
  when?: { template?: string[]; tab?: string[] };
}

/** One project template in a New Project tab's Template dropdown, e.g. "Console App"; the description shows under it. */
export interface NewProjectTemplate {
  id: string;
  label: string;
  description?: string;
}

/** A tab of templates along the top of the language's New Project page, e.g. ".NET" or "Web". */
export interface NewProjectTab {
  id: string;
  label: string;
  templates: NewProjectTemplate[];
}

export interface ManifestNewProject {
  /** The language the project is created as (shown in the New Project sidebar). */
  language: string;
  /**
   * Templates to choose from, in tabs along the top. The chosen one reaches `onCreate` as
   * `fields.tab` and `fields.template`. Leave out for a page of fields only.
   */
  tabs?: NewProjectTab[];
  fields: NewProjectField[];
}

/** Whether a New Project field applies to the chosen tab and template (fields without `when` always do). */
export function fieldApplies(field: NewProjectField, choice: { tab?: string; template?: string }): boolean {
  if (!field.when) return true;
  const { template, tab } = field.when;
  return (!template || (!!choice.template && template.includes(choice.template))) && (!tab || (!!choice.tab && tab.includes(choice.tab)));
}

/**
 * A setting a module adds to its own tab in Settings, e.g. Java's JAR location. Same field types
 * as New Project. Ids are local to the module ("jarPath").
 */
export interface ManifestSetting extends NewProjectField {
  description?: string;
}

export interface LanguageVersion {
  id: string;
  label: string;
  detail?: string;
}

export interface LanguageVersionChoices {
  items: LanguageVersion[];
  addLabel?: string;
}

export const versionsProvider = (languageId: string) => `@versions:${languageId}`;

export const RUN_PROVIDER = '@run';
export const TESTS_PROVIDER = '@tests';

export interface TestItem {
  id: string;
  label: string;
  path?: string;
  line?: number;
  children?: TestItem[];
}

export interface TestResult {
  id: string;
  state: 'running' | 'passed' | 'failed' | 'skipped';
  message?: string;
  durationMs?: number;
  label?: string;
  parentId?: string;
  path?: string;
  line?: number;
}

export interface TestGroup {
  controllerId: string;
  moduleId: string;
  label: string;
  items: TestItem[];
  error?: string;
  canDebug?: boolean;
  canCover?: boolean;
}

export interface TestSet {
  name: string;
  tests: { controllerId: string; id: string }[];
}

export interface TestDebugLaunch {
  languageId: string;
  launch: Record<string, unknown>;
  name?: string;
}

export interface FileCoverage {
  path: string;
  covered: number[];
  uncovered: number[];
}

export type TestEvent =
  | { runId: string; kind: 'coverage'; controllerId: string; files: FileCoverage[] }
  | { runId: string; kind: 'result'; controllerId: string; result: TestResult }
  | { runId: string; kind: 'output'; controllerId: string; text: string }
  | { runId: string; kind: 'done'; controllerId: string; error?: string };

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
  tests?: boolean;
  settings?: ManifestSetting[];
  buttons?: ManifestButton[];
}

/** saturn-language.json */
export interface LanguageManifest extends CodeModuleManifest {
  contributes?: CommonContributions & {
    languages?: ManifestLanguage[];
    languageServer?: ManifestLanguageServer;
    debugger?: ManifestDebugger;
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
  /** `features`: what its server supports and the user hasn't switched off (empty without a server). */
  languages: (ManifestLanguage & ModuleLook & { moduleId: string; hasServer: boolean; features: LanguageFeature[] })[];
  /** `iconUrl` is the panel's own icon file, else the module's icon, else null (shown as "?"). */
  panels: (ManifestPanel & { moduleId: string; iconUrl: string | null })[];
  commands: (ManifestCommand & ModuleLook & { moduleId: string; moduleName: string })[];
  previews: (ManifestPreview & { moduleId: string })[];
  fileTemplates: (ManifestFileTemplate & { moduleId: string })[];
  newProject: (ManifestNewProject & ModuleLook & { moduleId: string; languageName: string })[];
  /** One Settings tab per module that declares settings. */
  settings: (ModuleLook & { kind: ModuleKind; moduleId: string; moduleName: string; items: ManifestSetting[]; features: LanguageFeature[] })[];
  /** Buttons on the editor's right-hand bar; `iconUrl` as for panels. */
  buttons: (ManifestButton & { moduleId: string; iconUrl: string | null })[];
  /** Languages that can be debugged, and with which module's debugger. */
  debuggers: { moduleId: string; label: string; languages: string[]; configurations: { id: string; label: string }[]; canAttach: boolean }[];
}

export type MessageKind = 'info' | 'warning' | 'error';

/** A button on a notification: run one of the module's commands, open its Settings tab, or open an https link. */
export interface NotificationAction {
  label: string;
  command?: string;
  openSettings?: boolean;
  url?: string;
  /** Saturn's own: restart to install a downloaded Saturn update. */
  installUpdate?: boolean;
  /** Saturn's own: open the Marketplace on a section. */
  openMarketplace?: 'languages' | 'themes' | 'extensions';
  /** Saturn's own: install every available update for installed languages, extensions and themes. */
  updateAll?: boolean;
}

/** An entry in the editor's notifications menu (the bell next to Settings). */
export interface AppNotification {
  id: string;
  /** The module that sent it, or "saturn". */
  moduleId: string;
  /** Shown only in this project's window; everywhere when left out. */
  projectPath?: string;
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

/** A position in a file, 0-based like LSP. */
export interface TextPosition {
  line: number;
  character: number;
}

/** A file open in an editor window, with its current text (unsaved edits included). */
export interface EditorFile {
  path: string;
  /** Its language, or null for plain text. */
  languageId: string | null;
  text: string;
  /** Has unsaved changes. */
  dirty: boolean;
}

/** The main selection (or just the cursor, when `text` is empty). */
export interface EditorSelection {
  text: string;
  start: TextPosition;
  end: TextPosition;
}

/** What an editor window reports about its files, for modules (`saturn.editor`). */
export type EditorEvent =
  | { type: 'file'; file: EditorFile }
  | { type: 'closed'; path: string }
  | { type: 'active'; path: string | null; selection: EditorSelection | null };

/** A file and its current text, for requests about the whole document (outline, formatting). */
export interface DocumentRequest {
  path: string;
  languageId: string;
  text: string;
}

/** Something defined in a file (LSP DocumentSymbol); `kind` is the LSP SymbolKind number. */
export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  /** Where its name is: what the outline jumps to. */
  range: TextRange;
  children: DocumentSymbol[];
}

/** One usage from Find Usages: where it is, and that line's text. */
export interface ReferenceLocation {
  path: string;
  range: TextRange;
  preview: string;
}

/** Replace `range` with `newText` (LSP TextEdit). */
export interface TextEdit {
  range: TextRange;
  newText: string;
}

/** Edits to one file, e.g. from a rename. */
export interface FileEdits {
  path: string;
  edits: TextEdit[];
}

/** Parameter hints for the call around the cursor: the signature, and which part of it is the current parameter. */
export interface SignatureHelp {
  label: string;
  documentation?: string;
  /** Start and end offsets of the current parameter within `label`, or null. */
  activeParameter: [number, number] | null;
}

/** Applies LSP edits (positions in the original text) to a text. */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const offset = (line: number, character: number) => {
    if (line >= lineStarts.length) return text.length;
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    return Math.min(lineStarts[line] + character, end);
  };
  const spans = edits
    .map((e) => ({ from: offset(e.range.line, e.range.character), to: offset(e.range.endLine, e.range.endCharacter), text: e.newText }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  let result = text;
  for (const s of spans) result = result.slice(0, s.from) + s.text + result.slice(s.to);
  return result;
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

/** Can a module needing `range` (e.g. "^0.2") run on API `version`? Same major, and a minor no newer than Saturn's; patches never matter. */
export function satisfiesCaret(range: string, version: string): boolean {
  const match = /^\^?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range.trim());
  if (!match) return false;
  const [maj, min = 0] = match.slice(1).map((n) => Number(n ?? 0));
  const [vMaj, vMin] = version.split('.').map(Number);
  return vMaj === maj && vMin >= min;
}
