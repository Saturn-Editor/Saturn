import { autocompletion, snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { Facet, StateEffect, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, showPanel, showTooltip, ViewPlugin, type Panel, type Tooltip, type ViewUpdate } from '@codemirror/view';
import type { CompletionItem, CompletionRequest, Diagnostic, FileEdits, ReferenceLocation, SourceLocation, TextEdit, TextRange } from '@shared/modules';
import { editorBehaviour } from '@renderer/editor/codemirrorSetup';

const SYNC_DELAY_MS = 300;

/** The file an editor shows and how to open a definition, for the language-server features. */
export interface LspFile {
  path: string;
  languageId: string;
  openLocation: (location: SourceLocation) => void;
  /** False when the language's "Error checking" switch is off: its diagnostics are dropped. */
  diagnostics: boolean;
  /** Which commands the language's server offers (and the user hasn't switched off). */
  commands: { references: boolean; rename: boolean; formatting: boolean };
  /** Shows Find Usages results (in the Usages panel). */
  showReferences: (symbol: string, list: ReferenceLocation[]) => void;
  /** Applies edits to open files and files on disk (a rename); resolves to how many files changed. */
  applyEdits: (files: FileEdits[]) => Promise<number>;
  /** A message for the status bar. */
  notify: (text: string, kind?: 'info' | 'error') => void;
}

/** Files whose language has error checking switched off. */
const diagnosticsOff = new Set<string>();

const lspFile = Facet.define<LspFile, LspFile | null>({ combine: (values) => values[0] ?? null });

/** Diagnostics last published per file, so they reappear when its tab is shown again. */
const diagnosticsByPath = new Map<string, Diagnostic[]>();
/** Editor views currently showing each file. */
const viewsByPath = new Map<string, Set<EditorView>>();

function offset(doc: Text, line: number, character: number): number {
  const l = doc.line(Math.min(Math.max(1, line + 1), doc.lines));
  return l.from + Math.min(Math.max(0, character), l.length);
}

function toCm(doc: Text, list: Diagnostic[]): CmDiagnostic[] {
  return list.map((d) => {
    const from = offset(doc, d.line, d.character);
    return {
      from,
      to: Math.max(from, offset(doc, d.endLine, d.endCharacter)),
      severity: d.severity === 'hint' ? 'hint' : d.severity,
      message: d.message,
      source: d.source,
    };
  });
}

/** Settings → Editor → SmartCode → error detection. While off, diagnostics are kept but not shown. */
let showDiagnostics = true;

export function setShowDiagnostics(on: boolean): void {
  showDiagnostics = on;
  for (const [path, views] of viewsByPath) {
    const list = on ? (diagnosticsByPath.get(path) ?? []) : [];
    for (const view of views) view.dispatch(setDiagnostics(view.state, toCm(view.state.doc, list)));
  }
  notifyCounts();
}

/** Error and warning counts per file, for the status bar. */
const countListeners = new Set<() => void>();

export function onDiagnosticCounts(listener: () => void): () => void {
  countListeners.add(listener);
  return () => countListeners.delete(listener);
}

/** Every file with showing errors or warnings, and its list (empty while error detection is off). */
export function allDiagnostics(): Map<string, Diagnostic[]> {
  const result = new Map<string, Diagnostic[]>();
  if (!showDiagnostics) return result;
  for (const [path, list] of diagnosticsByPath) {
    const shown = list.filter((d) => d.severity === 'error' || d.severity === 'warning');
    if (shown.length) result.set(path, shown);
  }
  return result;
}

/** How many errors and warnings are showing for a file (zero while error detection is off). */
export function diagnosticCounts(path: string): { errors: number; warnings: number } {
  const list = showDiagnostics ? (diagnosticsByPath.get(path) ?? []) : [];
  return { errors: list.filter((d) => d.severity === 'error').length, warnings: list.filter((d) => d.severity === 'warning').length };
}

function notifyCounts(): void {
  countListeners.forEach((l) => l());
}

/** A language server published diagnostics for a file: shows them in any editor displaying it. */
export function receiveDiagnostics(path: string, list: Diagnostic[]): void {
  if (diagnosticsOff.has(path)) {
    if (diagnosticsByPath.delete(path)) notifyCounts();
    return;
  }
  // Servers often re-send the same results; re-applying them would close an open error popup.
  if (JSON.stringify(diagnosticsByPath.get(path) ?? []) === JSON.stringify(list)) return;
  diagnosticsByPath.set(path, list);
  notifyCounts();
  if (!showDiagnostics) return;
  for (const view of viewsByPath.get(path) ?? []) view.dispatch(setDiagnostics(view.state, toCm(view.state.doc, list)));
}

function request(state: EditorState, file: LspFile, pos: number): CompletionRequest {
  const line = state.doc.lineAt(pos);
  return { path: file.path, languageId: file.languageId, text: state.doc.toString(), line: line.number - 1, character: pos - line.from };
}

/** LSP snippets use $1 and ${1:name}; CodeMirror wants ${1} and ${1:name}. */
function snippetTemplate(text: string): string {
  return text.replace(/\$(\d+)/g, '${$1}');
}

function rangeFrom(state: EditorState, r: TextRange): { from: number; to: number } {
  return { from: offset(state.doc, r.line, r.character), to: offset(state.doc, r.endLine, r.endCharacter) };
}

/** Builds a CodeMirror option that inserts the item over the server's range, as a snippet if it is one. */
function option(item: CompletionItem): Completion {
  const text = item.insertText ?? item.label;
  return {
    label: item.label,
    detail: item.detail,
    apply: (view, _completion, from, to) => {
      const range = item.range ? rangeFrom(view.state, item.range) : null;
      // The server's range ends where the request was made; extend it over anything typed since.
      const start = range?.from ?? from;
      const end = Math.max(range?.to ?? to, to);
      if (item.snippet) snippet(snippetTemplate(text))(view, null as unknown as Completion, start, end);
      else view.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor: start + text.length } });
    },
  };
}

/** Completion from the language's server, triggered while typing a word or on Ctrl+Space. */
function completion(file: LspFile): Extension {
  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(/[\w#`[\]-]*/);
    if (!ctx.explicit && (!word || word.from === word.to)) return null;
    const items = await window.saturn.languages.complete(request(ctx.state, file, ctx.pos)).catch(() => []);
    if (ctx.aborted || items.length === 0) return null;
    // Filter from the server's replace range when it gives one, else from the word before the cursor.
    const ranged = items.find((i) => i.range);
    const from = ranged?.range ? Math.min(rangeFrom(ctx.state, ranged.range).from, ctx.pos) : (word?.from ?? ctx.pos);
    return { from, options: items.map(option) };
  };
  return autocompletion({ override: [source] });
}

/** Hover text from the server, shown as plain text. */
function hover(file: LspFile): Extension {
  return hoverTooltip(async (view, pos) => {
    const text = await window.saturn.languages.hover(request(view.state, file, pos)).catch(() => null);
    if (!text) return null;
    return {
      pos,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-saturn-hover';
        dom.textContent = text.replace(/^```\w*\n?|```$/gm, '').trim();
        return { dom };
      },
    };
  });
}

/** Opens where the symbol at `pos` is defined. Returns false if there's no language server for this editor. */
export function goToDefinition(view: EditorView, pos = view.state.selection.main.head): boolean {
  const file = view.state.facet(lspFile);
  if (!file) return false;
  void window.saturn.languages.definition(request(view.state, file, pos)).then((loc) => loc && file.openLocation(loc), () => undefined);
  return true;
}

/** Find Usages for the symbol at the cursor. Returns false if this editor's server doesn't offer it. */
export function findReferences(view: EditorView): boolean {
  const file = view.state.facet(lspFile);
  if (!file?.commands.references) return false;
  const pos = view.state.selection.main.head;
  const word = view.state.wordAt(pos);
  const symbol = word ? view.state.sliceDoc(word.from, word.to) : '';
  void window.saturn.languages.references(request(view.state, file, pos)).then(
    (list) => (list.length ? file.showReferences(symbol, list) : file.notify(`No usages of ${symbol || 'this'} found`)),
    () => file.notify("Couldn't find usages", 'error'),
  );
  return true;
}

/** Applies a server's edits to this editor's text, keeping the cursor where it was relative to the code. */
function applyToView(view: EditorView, edits: TextEdit[]): void {
  const changes = edits.map((e) => ({ ...rangeFrom(view.state, e.range), insert: e.newText }));
  if (changes.length) view.dispatch({ changes, userEvent: 'format' });
}

/** Formats the whole file with its language server. Resolves false if this editor's server doesn't offer it. */
export async function formatDocument(view: EditorView): Promise<boolean> {
  const file = view.state.facet(lspFile);
  if (!file?.commands.formatting) return false;
  const before = view.state.doc;
  const edits = await window.saturn.languages.format({
    path: file.path,
    languageId: file.languageId,
    text: before.toString(),
    tabSize: editorBehaviour.indentSize,
    insertSpaces: editorBehaviour.indentWith === 'spaces',
  }).catch(() => []);
  // Typing while the server worked would make its edits land in the wrong places.
  if (view.state.doc !== before) return true;
  applyToView(view, edits);
  return true;
}

const setRename = StateEffect.define<{ pos: number; word: string } | null>();

/** The rename box at the bottom of the editor: "Rename <word> to [new name]". */
function renamePanel(view: EditorView, target: { pos: number; word: string }): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-saturn-rename';
  dom.dataset.testid = 'rename-panel';
  const label = document.createElement('span');
  label.textContent = `Rename ${target.word} to`;
  const input = document.createElement('input');
  input.className = 'cm-textfield';
  input.value = target.word;
  input.setAttribute('aria-label', 'New name');
  const close = () => {
    view.dispatch({ effects: setRename.of(null) });
    view.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const newName = input.value.trim();
    const file = view.state.facet(lspFile);
    close();
    if (!file || !newName || newName === target.word) return;
    void window.saturn.languages.rename({ ...request(view.state, file, target.pos), newName })
      .then((files) => (files.length ? file.applyEdits(files) : 0))
      .then((count) => file.notify(count ? `Renamed ${target.word} to ${newName} in ${count} file${count === 1 ? '' : 's'}` : `${target.word} can't be renamed here`))
      .catch((e: Error) => file.notify(`Couldn't rename ${target.word}: ${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error'));
  });
  dom.append(label, input);
  return { dom, mount: () => input.select() };
}

const renameField = StateField.define<{ pos: number; word: string } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setRename)) return e.value;
    return value && tr.docChanged ? { ...value, pos: tr.changes.mapPos(value.pos) } : value;
  },
  provide: (f) => showPanel.from(f, (target) => (target ? (view) => renamePanel(view, target) : null)),
});

/** Opens the rename box for the symbol at the cursor. Returns false if this editor's server doesn't offer rename. */
export function renameSymbol(view: EditorView): boolean {
  const file = view.state.facet(lspFile);
  if (!file?.commands.rename) return false;
  const pos = view.state.selection.main.head;
  const word = view.state.wordAt(pos);
  if (!word) return true;
  view.dispatch({ effects: setRename.of({ pos, word: view.state.sliceDoc(word.from, word.to) }) });
  return true;
}

const setSignature = StateEffect.define<Tooltip | null>();

const signatureField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSignature)) return e.value;
    if (!value) return value;
    // Leaving the line closes the hints; otherwise they follow the text.
    const head = tr.state.selection.main.head;
    if (tr.state.doc.lineAt(head).number !== tr.startState.doc.lineAt(tr.startState.selection.main.head).number) return null;
    return tr.docChanged ? { ...value, pos: tr.changes.mapPos(value.pos) } : value;
  },
  provide: (f) => showTooltip.from(f),
});

/** Parameter hints: typing ( or , asks the server about the call; ) or Escape closes them. */
function signatureHelp(file: LspFile): Extension {
  const ask = (view: EditorView) => {
    const pos = view.state.selection.main.head;
    void window.saturn.languages.signatureHelp(request(view.state, file, pos)).then((help) => {
      if (view.state.selection.main.head !== pos) return;
      view.dispatch({
        effects: setSignature.of(help && {
          pos,
          above: true,
          create: () => {
            const dom = document.createElement('div');
            dom.className = 'cm-saturn-hover';
            dom.dataset.testid = 'signature-help';
            const [start, end] = help.activeParameter ?? [0, 0];
            const current = document.createElement('strong');
            current.className = 'cm-saturn-parameter';
            current.textContent = help.label.slice(start, end);
            dom.append(help.label.slice(0, start), current, help.label.slice(end));
            if (help.documentation) {
              const doc = document.createElement('div');
              doc.className = 'cm-saturn-signature-doc';
              doc.textContent = help.documentation;
              dom.append(doc);
            }
            return { dom };
          },
        }),
      });
    }, () => undefined);
  };
  return [
    signatureField,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      for (const tr of update.transactions) {
        if (!tr.isUserEvent('input.type')) continue;
        tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
          const typed = inserted.toString();
          if (typed.includes(')')) queueMicrotask(() => update.view.dispatch({ effects: setSignature.of(null) }));
          else if (/[(,]/.test(typed)) queueMicrotask(() => ask(update.view));
        });
      }
    }),
    keymap.of([{ key: 'Escape', run: (view) => (view.state.field(signatureField) ? (view.dispatch({ effects: setSignature.of(null) }), true) : false) }]),
  ];
}

/** Keeps the server's copy of the file current, and shows its diagnostics in this editor. */
const documentSync = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly view: EditorView) {
    const file = view.state.facet(lspFile);
    if (!file) return;
    if (!viewsByPath.has(file.path)) viewsByPath.set(file.path, new Set());
    viewsByPath.get(file.path)!.add(view);
    if (file.diagnostics) diagnosticsOff.delete(file.path);
    else {
      diagnosticsOff.add(file.path);
      if (diagnosticsByPath.delete(file.path)) notifyCounts();
    }
    this.send();
    const known = diagnosticsByPath.get(file.path);
    // Applying state during construction isn't allowed, so the saved diagnostics go in on the next tick.
    if (known && showDiagnostics) queueMicrotask(() => view.dispatch(setDiagnostics(view.state, toCm(view.state.doc, known))));
  }

  update(update: ViewUpdate) {
    if (!update.docChanged) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.send(), SYNC_DELAY_MS);
  }

  destroy() {
    clearTimeout(this.timer);
    const file = this.view.state.facet(lspFile);
    if (file) viewsByPath.get(file.path)?.delete(this.view);
  }

  private send() {
    const file = this.view.state.facet(lspFile);
    if (file) void window.saturn.languages.syncDocument({ path: file.path, languageId: file.languageId, text: this.view.state.doc.toString() }).catch(() => undefined);
  }
});

/** Cmd-click (Ctrl-click elsewhere) goes to the definition. */
const clickToDefinition = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (!(navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey) || e.button !== 0) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return false;
    e.preventDefault();
    return goToDefinition(view, pos);
  },
});

/** What a file gets from its language server: always sync (and diagnostics unless off), plus the features switched on. */
export function languageServerFeatures(file: LspFile, on: { completion: boolean; hover: boolean; definition: boolean; signatureHelp: boolean }): Extension {
  // No gutter markers: the line-number column is kept free for breakpoints.
  return [
    lspFile.of(file),
    documentSync,
    ...(file.commands.rename ? [renameField] : []),
    ...(on.signatureHelp ? [signatureHelp(file)] : []),
    ...(on.hover ? [hover(file)] : []),
    ...(on.definition ? [clickToDefinition] : []),
    ...(on.completion ? [completion(file)] : []),
  ];
}
