/** The module API version this build of Saturn implements. Modules declare a compatible range in `saturnApi`. */
export const SATURN_API_VERSION = '0.1.0';

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
  args?: string[];
}

export interface ManifestPanel {
  id: string;
  title: string;
  dock: 'left' | 'bottom';
  /** Short text shown as the panel's icon, e.g. "MD". */
  badge?: string;
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

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Short text used as the language's icon, e.g. "MD", "C#". */
  badge?: string;
  saturnApi: string;
  /** Entry point (ES module exporting `activate(saturn)`), relative to the module folder. */
  main?: string;
  activationEvents?: string[];
  contributes?: {
    languages?: ManifestLanguage[];
    languageServer?: ManifestLanguageServer;
    panels?: ManifestPanel[];
    commands?: ManifestCommand[];
    previews?: ManifestPreview[];
    fileTemplates?: ManifestFileTemplate[];
    newProject?: ManifestNewProject;
    runConfigurations?: boolean;
  };
}

export interface ModuleSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  badge: string;
  enabled: boolean;
  /** Null when compatible; otherwise why the module can't load. */
  incompatible: string | null;
  languages: string[];
}

/** Everything enabled modules contribute, as sent to each window. */
export interface ContributionSnapshot {
  languages: (ManifestLanguage & { moduleId: string; badge: string; hasServer: boolean })[];
  panels: (ManifestPanel & { moduleId: string })[];
  commands: (ManifestCommand & { moduleId: string; moduleName: string; badge: string })[];
  previews: (ManifestPreview & { moduleId: string })[];
  fileTemplates: (ManifestFileTemplate & { moduleId: string })[];
  newProject: (ManifestNewProject & { moduleId: string; languageName: string; badge: string })[];
}

export interface TreeItem {
  id: string;
  label: string;
  hasChildren: boolean;
  /** Opening the item opens this file (project-relative or absolute). */
  open?: { path: string; line?: number };
}

export interface CompletionItem {
  label: string;
  detail?: string;
  insertText?: string;
  kind?: number;
}

export interface CompletionRequest {
  path: string;
  languageId: string;
  text: string;
  line: number;
  character: number;
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
