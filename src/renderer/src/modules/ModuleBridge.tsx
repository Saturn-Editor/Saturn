import { effect, signal } from '@preact/signals';
import type { Extension } from '@codemirror/state';
import type { ContributionSnapshot, LanguageFeature, ModuleLook } from '@shared/modules';
import type { AppSettings } from '@shared/types';
import { ModuleIcon, QuestionIcon } from '@renderer/components';
import { editorBehaviour } from '@renderer/editor/codemirrorSetup';
import { ModuleTreePanel } from '@renderer/panels/builtin/ModuleTreePanel';
import type { EditorWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { languageServerFeatures, receiveDiagnostics, setShowDiagnostics } from './languageServer';
import { clearGrammars, loadGrammar, textMateHighlighting } from './textmate';

export const EMPTY_SNAPSHOT: ContributionSnapshot = { languages: [], panels: [], commands: [], previews: [], fileTemplates: [], newProject: [], settings: [], buttons: [], debuggers: [] };

export type LanguageInfo = ContributionSnapshot['languages'][number];

/** A file language choice meaning "no language". */
export const PLAIN_TEXT_LANGUAGE = 'plain-text';

/** The languages claiming a file by extension (case-insensitive), each with the extension it matched. */
export function languageCandidates(snapshot: ContributionSnapshot, path: string): { language: LanguageInfo; extension: string }[] {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  return snapshot.languages.flatMap((language) => {
    const extension = language.extensions.map((e) => e.toLowerCase()).filter((e) => name.endsWith(e)).sort((a, b) => b.length - a.length)[0];
    return extension ? [{ language, extension }] : [];
  });
}

/**
 * The language a file opens as: the one picked for that file (status bar), else the one picked for
 * its extension when several languages claim it, else the first that claims it.
 */
export function languageForPath(
  snapshot: ContributionSnapshot,
  path: string,
  choices: { files?: Record<string, string>; extensions?: Record<string, string> } = {},
): LanguageInfo | undefined {
  const picked = choices.files?.[path];
  if (picked === PLAIN_TEXT_LANGUAGE) return undefined;
  const pickedLanguage = picked ? snapshot.languages.find((l) => l.id === picked) : undefined;
  if (pickedLanguage) return pickedLanguage;
  const candidates = languageCandidates(snapshot, path);
  return (candidates.find((c) => choices.extensions?.[c.extension] === c.language.id) ?? candidates[0])?.language;
}

/** Icons for a project's languages (installed ones only, one per language module, up to three); "T" for plain text. */
export function projectBadges(snapshot: ContributionSnapshot, languageIds: string[]): ModuleLook[] {
  const looks: ModuleLook[] = [];
  for (const id of languageIds) {
    const language = snapshot.languages.find((l) => l.id === id);
    if (language && !looks.some((l) => l.badge === language.badge)) looks.push({ badge: language.badge, icon: language.icon });
  }
  return looks.length ? looks.slice(0, 3) : [{ badge: 'T', icon: null }];
}

/**
 * Connects an editor window to the enabled language modules: registers their commands, panels,
 * file templates and previews in the window's registries, and re-registers whenever modules change.
 */
export class ModuleBridge {
  readonly snapshot = signal<ContributionSnapshot>(EMPTY_SNAPSHOT);
  /** Bumped whenever modules or the completion setting change, so open editors rebuild their language support. */
  readonly version = signal(0);
  private disposers: (() => void)[] = [];
  /** The Settings "Code completion" switch. */
  private completion = true;

  constructor(private readonly ws: EditorWorkspace) {}

  async start(): Promise<void> {
    const api = window.saturn.modules;
    // Completion and Behaviour settings shape each editor, so a change rebuilds the open ones.
    const read = (s: AppSettings) => {
      this.ws.formatOnSave = s.formatOnSave;
      this.ws.defaultViews.value = s.defaultViews;
      const behaviour = { autoIndent: s.autoIndent, indentWith: s.indentWith, indentSize: s.indentSize, autoCloseBrackets: s.autoCloseBrackets };
      const changed = s.completion !== this.completion ||
        (Object.keys(behaviour) as (keyof typeof behaviour)[]).some((k) => behaviour[k] !== editorBehaviour[k]);
      this.completion = s.completion;
      Object.assign(editorBehaviour, behaviour);
      return changed;
    };
    const initial = await window.saturn.settings.get();
    read(initial);
    // Language choices change which language a file opens as, so open editors rebuild.
    this.extensionLanguages.value = initial.extensionLanguages;
    this.fileLanguages.value = await window.saturn.languages.fileChoices();
    window.saturn.languages.onChoicesChanged((choices) => {
      this.fileLanguages.value = choices;
      this.version.value++;
    });
    setShowDiagnostics(initial.diagnostics);
    this.ws.documents.autoSave = initial.autoSave;
    window.addEventListener('blur', () => this.ws.documents.saveOnLeave());
    window.saturn.settings.onChanged((s) => {
      setShowDiagnostics(s.diagnostics);
      this.ws.documents.autoSave = s.autoSave;
      const extensionsChanged = JSON.stringify(s.extensionLanguages) !== JSON.stringify(this.extensionLanguages.value);
      this.extensionLanguages.value = s.extensionLanguages;
      if (read(s) || extensionsChanged) this.version.value++;
    });
    this.apply(await api.snapshot());
    api.onChanged((snapshot) => this.apply(snapshot));
    api.onOpenFile((path, line, column) => void this.ws.documents.open(this.absolute(path), { line, column }));
    window.saturn.languages.onDiagnostics((path, list) => receiveDiagnostics(path, list));
    // A closed tab is closed on its language server too (didClose).
    let open = new Set<string>();
    effect(() => {
      const now = new Set(this.ws.documents.docs.value.map((d) => d.path));
      for (const path of open) {
        const language = now.has(path) ? undefined : this.languageFor(path);
        if (language?.hasServer) void window.saturn.languages.closeDocument({ path, languageId: language.id }).catch(() => undefined);
      }
      open = now;
    });
    api.onRunInTerminal((name, command) => {
      void this.ws.terminals.openTerminal({ name, command }).then(() => this.ws.showTerminal());
    });
    api.onMessage((m) => (this.ws.notice.value = { text: m.message, kind: m.kind }));
  }

  languageFor(path: string): LanguageInfo | undefined {
    return languageForPath(this.snapshot.value, path, { files: this.fileLanguages.value, extensions: this.extensionLanguages.value });
  }

  /** Languages picked for single files in this project (path → language id, or PLAIN_TEXT_LANGUAGE). */
  readonly fileLanguages = signal<Record<string, string>>({});
  /** Settings: which language opens an extension several languages claim. */
  readonly extensionLanguages = signal<Record<string, string>>({});

  /** Highlighting and completion for a file, from its language's module (empty for plain text). */
  async editorExtensions(path: string): Promise<Extension[]> {
    const language = this.languageFor(path);
    if (!language) return [];
    const extensions: Extension[] = [];
    if (language.grammar) {
      const grammar = await loadGrammar(language.id).catch(() => null);
      if (grammar) extensions.push(textMateHighlighting(grammar));
    }
    if (language.hasServer) {
      const openLocation = (loc: { path: string; line: number; column: number }) => void this.ws.documents.open(loc.path, { line: loc.line, column: loc.column });
      // Each feature needs the server to support it, the language's own switch, and (for completion) SmartCode's.
      const has = (f: LanguageFeature) => language.features.includes(f);
      extensions.push(languageServerFeatures(
        {
          path,
          languageId: language.id,
          openLocation,
          diagnostics: has('diagnostics'),
          commands: { references: has('references'), rename: has('rename'), formatting: has('formatting') },
          showReferences: (symbol, list) => this.ws.showReferences(symbol, list),
          applyEdits: (files) => this.ws.applyEdits(files),
          notify: (text, kind = 'info') => (this.ws.notice.value = { text, kind }),
        },
        { completion: this.completion && has('completion'), hover: has('hover'), definition: has('definition'), signatureHelp: has('signatureHelp') },
      ));
    }
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
        source: { id: cmd.moduleId, label: cmd.moduleName, icon: <ModuleIcon icon={cmd.icon} badge={cmd.badge} /> },
        run: () => api.runCommand(cmd.id),
      }));
    }
    for (const panel of snapshot.panels) {
      this.disposers.push(ws.panels.register({
        id: panel.id,
        title: panel.title,
        // A strip button needs something to show, so panels without an icon get "?".
        icon: panel.iconUrl ? <ModuleIcon icon={panel.iconUrl} badge={panel.title} /> : <QuestionIcon />,
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
        icon: language && <ModuleIcon icon={language.icon} badge={language.badge} />,
        build: (ctx) => api.templateFile(t.id, ctx.name, ctx.dir),
      }));
    }
    for (const p of snapshot.previews) {
      this.disposers.push(ws.previews.register({
        id: p.id,
        label: p.label,
        extensions: p.extensions,
        source: p.moduleId,
        defaultView: p.defaultView,
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
