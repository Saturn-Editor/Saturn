import { Prec, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { CodeLensItem, InlayHint, SemanticToken } from '@shared/modules';
import { isThemeChange, semanticMark } from './textmate';

const REFRESH_MS = 500;

interface ExtrasFile {
  path: string;
  languageId: string;
  findReferences(view: EditorView, pos: number): void;
}

function offset(doc: Text, line: number, character: number): number | null {
  if (line + 1 > doc.lines) return null;
  const l = doc.line(line + 1);
  return l.from + Math.min(character, l.length);
}

function decorationField(): { field: StateField<DecorationSet>; set: ReturnType<typeof StateEffect.define<DecorationSet>> } {
  const set = StateEffect.define<DecorationSet>();
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(set)) return e.value;
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return { field, set };
}

function refresher(fetch: (view: EditorView) => Promise<void>, onViewport = false, onTheme = false): Extension {
  return ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {
      this.schedule(0);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || (onViewport && update.viewportChanged) || (onTheme && isThemeChange(update))) this.schedule(REFRESH_MS);
    }
    schedule(delay: number) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void fetch(this.view).catch(() => undefined), delay);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  });
}

class HintWidget extends WidgetType {
  constructor(readonly hint: InlayHint) {
    super();
  }
  eq(other: HintWidget) {
    return other.hint.label === this.hint.label && other.hint.paddingLeft === this.hint.paddingLeft && other.hint.paddingRight === this.hint.paddingRight;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-saturn-inlay';
    span.textContent = `${this.hint.paddingLeft ? ' ' : ''}${this.hint.label}${this.hint.paddingRight ? ' ' : ''}`;
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

export function inlayHints(file: ExtrasFile): Extension {
  const { field, set } = decorationField();
  const fetch = async (view: EditorView) => {
    const text = view.state.doc.toString();
    const { from, to } = view.viewport;
    const hints = await window.saturn.languages.inlayHints({
      path: file.path, languageId: file.languageId, text,
      fromLine: view.state.doc.lineAt(from).number - 1, toLine: view.state.doc.lineAt(to).number - 1,
    });
    if (view.state.doc.toString() !== text) return;
    const ranges = hints
      .map((h) => ({ pos: offset(view.state.doc, h.line, h.character), h }))
      .filter((r): r is { pos: number; h: InlayHint } => r.pos !== null)
      .sort((a, b) => a.pos - b.pos)
      .map(({ pos, h }) => Decoration.widget({ widget: new HintWidget(h), side: 1 }).range(pos));
    view.dispatch({ effects: set.of(Decoration.set(ranges)) });
  };
  return [field, refresher(fetch, true)];
}

class LensWidget extends WidgetType {
  constructor(readonly lenses: CodeLensItem[], readonly indent: string, readonly run: (lens: CodeLensItem) => void) {
    super();
  }
  eq(other: LensWidget) {
    return other.indent === this.indent && other.lenses.map((l) => l.title).join('\0') === this.lenses.map((l) => l.title).join('\0');
  }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'cm-saturn-codelens';
    div.style.paddingLeft = `${this.indent.replace(/\t/g, '    ').length}ch`;
    this.lenses.forEach((lens, i) => {
      if (i) div.append(' | ');
      const button = document.createElement('button');
      button.textContent = lens.title;
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => this.run(lens));
      div.append(button);
    });
    return div;
  }
  ignoreEvent() {
    return false;
  }
}

export function codeLens(file: ExtrasFile): Extension {
  const { field, set } = decorationField();
  const fetch = async (view: EditorView) => {
    const text = view.state.doc.toString();
    const lenses = await window.saturn.languages.codeLenses({ path: file.path, languageId: file.languageId, text });
    if (view.state.doc.toString() !== text) return;
    const byLine = new Map<number, CodeLensItem[]>();
    for (const lens of lenses) {
      if (lens.lensLine + 1 > view.state.doc.lines) continue;
      byLine.set(lens.lensLine, [...(byLine.get(lens.lensLine) ?? []), lens]);
    }
    const run = (lens: CodeLensItem) => {
      const pos = offset(view.state.doc, lens.line, lens.character);
      if (lens.references && pos !== null) file.findReferences(view, pos);
      else void window.saturn.languages.runCodeLens(file.languageId, file.path, lens.index).catch(() => undefined);
    };
    const ranges = [...byLine].sort(([a], [b]) => a - b).map(([line, items]) => {
      const l = view.state.doc.line(line + 1);
      const indent = l.text.match(/^\s*/)![0];
      return Decoration.widget({ widget: new LensWidget(items, indent, run), block: true, side: -1 }).range(l.from);
    });
    view.dispatch({ effects: set.of(Decoration.set(ranges)) });
  };
  return [field, refresher(fetch)];
}

export function semanticHighlighting(file: ExtrasFile): Extension {
  const { field, set } = decorationField();
  const build = (view: EditorView, tokens: SemanticToken[]) => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const t of tokens) {
      const from = offset(view.state.doc, t.line, t.character);
      if (from === null) continue;
      const mark = semanticMark(t.scopes);
      const to = Math.min(from + t.length, view.state.doc.line(t.line + 1).to);
      if (mark && to > from) builder.add(from, to, mark);
    }
    return builder.finish();
  };
  const fetch = async (view: EditorView) => {
    const text = view.state.doc.toString();
    const tokens = await window.saturn.languages.semanticTokens({ path: file.path, languageId: file.languageId, text });
    if (view.state.doc.toString() !== text) return;
    view.dispatch({ effects: set.of(build(view, tokens)) });
  };
  return [Prec.lowest(field), refresher(fetch, false, true)];
}
