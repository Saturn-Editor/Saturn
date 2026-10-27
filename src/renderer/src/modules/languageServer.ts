import { autocompletion, snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { Facet, type EditorState, type Extension, type Text } from '@codemirror/state';
import { EditorView, hoverTooltip, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { CompletionItem, CompletionRequest, Diagnostic, SourceLocation, TextRange } from '@shared/modules';

const SYNC_DELAY_MS = 300;

/** The file an editor shows and how to open a definition, for the language-server features. */
export interface LspFile {
  path: string;
  languageId: string;
  openLocation: (location: SourceLocation) => void;
}

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

/** A language server published diagnostics for a file: shows them in any editor displaying it. */
export function receiveDiagnostics(path: string, list: Diagnostic[]): void {
  diagnosticsByPath.set(path, list);
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
    const items = await window.saturn.modules.complete(request(ctx.state, file, ctx.pos)).catch(() => []);
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
    const text = await window.saturn.modules.hover(request(view.state, file, pos)).catch(() => null);
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
  void window.saturn.modules.definition(request(view.state, file, pos)).then((loc) => loc && file.openLocation(loc), () => undefined);
  return true;
}

/** Keeps the server's copy of the file current, and shows its diagnostics in this editor. */
const documentSync = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly view: EditorView) {
    const file = view.state.facet(lspFile);
    if (!file) return;
    if (!viewsByPath.has(file.path)) viewsByPath.set(file.path, new Set());
    viewsByPath.get(file.path)!.add(view);
    this.send();
    const known = diagnosticsByPath.get(file.path);
    // Applying state during construction isn't allowed, so the saved diagnostics go in on the next tick.
    if (known) queueMicrotask(() => view.dispatch(setDiagnostics(view.state, toCm(view.state.doc, known))));
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
    if (file) void window.saturn.modules.syncDocument({ path: file.path, languageId: file.languageId, text: this.view.state.doc.toString() }).catch(() => undefined);
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

/** Everything a file gets from its language server: sync, diagnostics, completion, hover and go to definition. */
export function languageServerFeatures(file: LspFile, { completion: withCompletion }: { completion: boolean }): Extension {
  return [
    lspFile.of(file),
    documentSync,
    lintGutter(),
    hover(file),
    clickToDefinition,
    ...(withCompletion ? [completion(file)] : []),
  ];
}
