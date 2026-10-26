import { signal } from '@preact/signals';
import type { Extension } from '@codemirror/state';
import type { ContributionSnapshot } from '@shared/modules';
import { Badge } from '@renderer/components';
import { ModuleTreePanel } from '@renderer/panels/builtin/ModuleTreePanel';
import type { EditorWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { lspCompletion } from './completion';
import { clearGrammars, loadGrammar, textMateHighlighting } from './textmate';

export const EMPTY_SNAPSHOT: ContributionSnapshot = { languages: [], panels: [], commands: [], previews: [], fileTemplates: [], newProject: [] };

export type LanguageInfo = ContributionSnapshot['languages'][number];

/** Finds the language for a file by extension (case-insensitive). */
export function languageForPath(snapshot: ContributionSnapshot, path: string): LanguageInfo | undefined {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  return snapshot.languages.find((l) => l.extensions.some((ext) => name.endsWith(ext.toLowerCase())));
}

/** Badges for a project's languages (installed ones only, up to three); "T" for plain text. */
export function projectBadges(snapshot: ContributionSnapshot, languageIds: string[]): string[] {
  const badges = languageIds
    .map((id) => snapshot.languages.find((l) => l.id === id)?.badge)
    .filter((b): b is string => !!b);
  return badges.length ? [...new Set(badges)].slice(0, 3) : ['T'];
}

/**
 * Connects an editor window to the enabled language modules: registers their commands, panels,
 * file templates and previews in the window's registries, and re-registers whenever modules change.
 */
export class ModuleBridge {
  readonly snapshot = signal<ContributionSnapshot>(EMPTY_SNAPSHOT);
  /** Bumped whenever modules change, so open editors rebuild their language support. */
  readonly version = signal(0);
  private disposers: (() => void)[] = [];

  constructor(private readonly ws: EditorWorkspace) {}

  async start(): Promise<void> {
    const api = window.saturn.modules;
    this.apply(await api.snapshot());
    api.onChanged((snapshot) => this.apply(snapshot));
    api.onOpenFile((path) => void this.ws.documents.open(this.absolute(path)));
    api.onHostProblem((message) => (this.ws.notice.value = message));
  }

  languageFor(path: string): LanguageInfo | undefined {
    return languageForPath(this.snapshot.value, path);
  }

  /** Highlighting and completion for a file, from its language's module (empty for plain text). */
  async editorExtensions(path: string): Promise<Extension[]> {
    const language = this.languageFor(path);
    if (!language) return [];
    const extensions: Extension[] = [];
    if (language.grammar) {
      const grammar = await loadGrammar(language.id).catch(() => null);
      if (grammar) extensions.push(textMateHighlighting(grammar));
    }
    if (language.hasServer) extensions.push(lspCompletion(path, language.id));
    return extensions;
  }

  private apply(snapshot: ContributionSnapshot): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    clearGrammars();
    const { ws } = this;
    const api = window.saturn.modules;

    for (const cmd of snapshot.commands) {
      this.disposers.push(ws.commands.register({
        id: cmd.id,
        title: cmd.title,
        source: { id: cmd.moduleId, label: cmd.moduleName, icon: <Badge text={cmd.badge} /> },
        run: () => api.runCommand(cmd.id),
      }));
    }
    for (const panel of snapshot.panels) {
      this.disposers.push(ws.panels.register({
        id: panel.id,
        title: panel.title,
        icon: <Badge text={panel.badge ?? '?'} />,
        defaultDock: panel.dock,
        source: panel.moduleId,
        render: () => <ModuleTreePanel panelId={panel.id} />,
      }));
    }
    for (const t of snapshot.fileTemplates) {
      const language = snapshot.languages.find((l) => l.moduleId === t.moduleId);
      this.disposers.push(ws.fileTemplates.register({
        id: t.id,
        label: t.label,
        kind: t.kind,
        extension: t.extension,
        placeholder: t.placeholder,
        source: t.moduleId,
        icon: language && <Badge text={language.badge} />,
        build: (ctx) => api.templateFile(t.id, ctx.name, ctx.dir),
      }));
    }
    for (const p of snapshot.previews) {
      this.disposers.push(ws.previews.register({
        id: p.id,
        label: p.label,
        extensions: p.extensions,
        source: p.moduleId,
        render: (text, ctx) => api.renderPreview(p.id, text, ctx.path),
      }));
    }
    this.snapshot.value = snapshot;
    this.version.value++;
  }

  private absolute(path: string): string {
    if (/^([a-zA-Z]:)?[\\/]/.test(path)) return path;
    const separator = this.ws.projectPath.includes('\\') ? '\\' : '/';
    return `${this.ws.projectPath}${separator}${path}`;
  }
}
