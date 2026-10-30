import { effect, signal } from '@preact/signals';
import type { Extension } from '@codemirror/state';
import type { ContributionSnapshot, EditorSelection, LanguageFeature, ModuleLook } from '@shared/modules';
import type { AppSettings } from '@shared/types';
import { ModuleIcon, QuestionIcon } from '@renderer/components';
import { editorBehaviour } from '@renderer/editor/codemirrorSetup';
import { ModuleTreePanel } from '@renderer/panels/builtin/ModuleTreePanel';
import { WebviewPanel } from '@renderer/panels/builtin/WebviewPanel';
import type { EditorWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import type { EditorView } from '@codemirror/view';
import { findReferences, languageServerFeatures, receiveDiagnostics, setShowDiagnostics } from './languageServer';
import { codeLens, inlayHints, semanticHighlighting } from './lspExtras';
import { clearGrammars, loadGrammar, textMateHighlighting } from './textmate';
import { docComments } from '@renderer/editor/docComments';
import { baseName } from '@renderer/helpers';

/** How long typing must pause before a file's new text reaches modules, and a selection change. */
const EDITOR_REPORT_MS = 300;
const SELECTION_REPORT_MS = 150;

export const EMPTY_SNAPSHOT: ContributionSnapshot = { languages: [], panels: [], commands: [], previews: [], fileTemplates: [], newProject: [], settings: [], buttons: [], debuggers: [] };

export type LanguageInfo = ContributionSnapshot['languages'][number];

/** The language a file opens as: the one claiming the longest matching extension (case-insensitive). */
export function languageForPath(snapshot: ContributionSnapshot, path: string): LanguageInfo | undefined {
  const name = baseName(path).toLowerCase();
  let best: { language: LanguageInfo; length: number } | undefined;
  for (const language of snapshot.languages) {
    for (const ext of language.extensions) {
      if (name.endsWith(ext.toLowerCase()) && (!best || ext.length > best.length)) best = { language, length: ext.length };
    }
  }
  return best?.language;
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

const SHOW_WHEN_DEPTH = 4;
const SHOW_WHEN_SKIP = new Set(['node_modules', 'bin', 'obj']);

async function projectFileNames(root: string, depth: number): Promise<{ root: string[]; all: string[] }> {
  const all: string[] = [];
  let rootNames: string[] = [];
  let level = [root];
  for (let d = 0; d <= depth && level.length; d++) {
    const next: string[] = [];
    for (const dir of level) {
      const entries = await window.saturn.fs.readDir(dir).catch(() => []);
      if (d === 0) rootNames = entries.map((e) => e.name);
      for (const e of entries) {
        if (e.kind === 'dir') {
          if (!e.name.startsWith('.') && !SHOW_WHEN_SKIP.has(e.name)) next.push(e.path);
        } else all.push(e.name);
      }
    }
    level = next;
  }
  return { root: rootNames, all };
}

function matchesName(name: string, pattern: string): boolean {
  const regex = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${regex}$`, 'i').test(name);
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
    setShowDiagnostics(initial.diagnostics);
    this.ws.documents.autoSave = initial.autoSave;
    window.addEventListener('blur', () => this.ws.documents.saveOnLeave());
    window.saturn.settings.onChanged((s) => {
      setShowDiagnostics(s.diagnostics);
      this.ws.documents.autoSave = s.autoSave;
      if (read(s)) this.version.value++;
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
    this.reportEditorState();
    api.onRunInTerminal((name, command) => {
      void this.ws.terminals.openTerminal({ name, command }).then(() => this.ws.showTerminal());
    });
    api.onMessage((m) => (this.ws.notice.value = { text: m.message, kind: m.kind }));
    api.onInputRequest((id, options) => {
      this.ws.inputPrompt.value?.resolve(null);
      this.ws.inputPrompt.value = { options, resolve: (value) => void api.reply(id, value) };
    });
    api.onApplyEditsRequest((id, files) => {
      this.ws.applyEdits(files).then(() => void api.reply(id, true), (e: Error) => void api.reply(id, null, e.message));
    });
    api.onRenameFileRequest((id, path, newName) => {
      const from = this.absolute(path);
      window.saturn.fs.rename(from, newName).then((to) => {
        this.ws.documents.moved(from, to);
        void api.reply(id, to);
      }, (e: Error) => void api.reply(id, null, e.message));
    });
  }

  /**
   * Keeps modules' `saturn.editor` current: each open file's text (shortly after typing pauses), closed
   * tabs, and the focused editor's file and selection.
   */
  private reportEditorState(): void {
    const { documents } = this.ws;
    const report = window.saturn.modules.reportEditor;
    const sent = new Map<string, string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    effect(() => {
      const docs = documents.docs.value;
      for (const doc of docs) {
        if (sent.get(doc.path) === `${doc.dirty}\0${doc.text}`) continue;
        clearTimeout(timers.get(doc.path));
        timers.set(doc.path, setTimeout(() => {
          const latest = documents.docs.value.find((d) => d.path === doc.path);
          if (!latest) return;
          sent.set(latest.path, `${latest.dirty}\0${latest.text}`);
          report({ type: 'file', file: { path: latest.path, languageId: this.languageFor(latest.path)?.id ?? null, text: latest.text, dirty: latest.dirty } });
        }, sent.has(doc.path) ? EDITOR_REPORT_MS : 0));
      }
      for (const path of [...sent.keys()]) {
        if (docs.some((d) => d.path === path)) continue;
        sent.delete(path);
        clearTimeout(timers.get(path));
        report({ type: 'closed', path });
      }
    });
    let activeTimer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const path = documents.active.value?.path ?? null;
      void this.ws.cursor.value; // selection moves update the cursor label
      clearTimeout(activeTimer);
      activeTimer = setTimeout(() => {
        const view = this.ws.activeView;
        const state = view?.state;
        let selection: EditorSelection | null = null;
        if (path && state) {
          const { from, to } = state.selection.main;
          const at = (pos: number) => {
            const line = state.doc.lineAt(pos);
            return { line: line.number - 1, character: pos - line.from };
          };
          selection = { text: state.sliceDoc(from, to), start: at(from), end: at(to) };
        }
        report({ type: 'active', path, selection });
      }, SELECTION_REPORT_MS);
    });
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
    if (language.hasServer) {
      const has = (f: LanguageFeature) => language.features.includes(f);
      const extras = {
        path,
        languageId: language.id,
        findReferences: (view: EditorView, pos: number) => {
          view.dispatch({ selection: { anchor: pos } });
          findReferences(view);
        },
      };
      if (has('inlayHints')) extensions.push(inlayHints(extras));
      if (has('codeLens')) extensions.push(codeLens(extras));
      if (has('semanticTokens')) extensions.push(semanticHighlighting(extras));
    }
    if (language.docCommentTriggers?.length) extensions.push(docComments(path, language.id, language.docCommentTriggers));
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
    const conditional: { panel: (typeof snapshot.panels)[number]; dispose: (() => void) | null }[] = [];
    const register = (panel: (typeof snapshot.panels)[number]) => ws.panels.register({
      id: panel.id,
      title: panel.title,
      // A strip button needs something to show, so panels without an icon get "?".
      icon: panel.iconUrl ? <ModuleIcon icon={panel.iconUrl} badge={panel.title} /> : <QuestionIcon />,
      defaultDock: panel.dock,
      source: panel.moduleId,
      render: () => (panel.kind === 'webview' ? <WebviewPanel panelId={panel.id} /> : <ModuleTreePanel panelId={panel.id} />),
    });
    for (const panel of snapshot.panels) {
      if (panel.showWhen?.length) conditional.push({ panel, dispose: null });
      else this.disposers.push(register(panel));
    }
    if (conditional.length) {
      const deep = conditional.some((c) => c.panel.showWhen!.some((p) => p.startsWith('**/')));
      const check = async () => {
        const names = await projectFileNames(ws.projectPath, deep ? SHOW_WHEN_DEPTH : 0);
        for (const c of conditional) {
          const show = c.panel.showWhen!.some((p) => (p.startsWith('**/')
            ? names.all.some((n) => matchesName(n, p.slice(3)))
            : names.root.some((n) => matchesName(n, p))));
          if (show && !c.dispose) c.dispose = register(c.panel);
          else if (!show && c.dispose) {
            c.dispose();
            c.dispose = null;
          }
        }
      };
      void check();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = window.saturn.fs.onChanged((dir) => {
        if (dir !== ws.projectPath && !(deep && dir.startsWith(ws.projectPath))) return;
        clearTimeout(timer);
        timer = setTimeout(() => void check(), 300);
      });
      this.disposers.push(() => {
        stop();
        conditional.forEach((c) => c.dispose?.());
      });
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
