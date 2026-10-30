import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';
import { INITIAL, parseRawGrammar, Registry, type IGrammar, type StateStack } from 'vscode-textmate';
import type { SyntaxRule } from '@shared/types';
import { activeTheme, resolveColor } from '@renderer/theme/ThemeApplier';

/** Lines past this are left uncoloured, so opening huge files stays responsive. */
const MAX_LINES = 5000;

let onig: Promise<void> | null = null;
function loadOniguruma(): Promise<void> {
  onig ??= fetch(onigWasmUrl).then((r) => r.arrayBuffer()).then((data) => loadWASM(data));
  return onig;
}

type RawGrammar = { scopeName: string };

const grammars = new Map<string, Promise<IGrammar | null>>();
let registry: Registry | null = null;

/**
 * One registry per window. When a grammar includes another by scope name (PHP embedding
 * "text.html.basic", Markdown embedding "source.js" in code blocks), it's fetched from whichever
 * installed language provides it; if none does, that part is left uncoloured.
 */
function sharedRegistry(): Registry {
  registry ??= new Registry({
    onigLib: loadOniguruma().then(() => ({
      createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
      createOnigString: (s: string) => new OnigString(s),
    })),
    loadGrammar: async (scope) => {
      // A missing scope gets an empty stub: returning null makes vscode-textmate drop the whole
      // begin/end rule that includes it (e.g. a ```js fence would vanish instead of staying plain).
      const raw = (await window.saturn.languages.grammarByScope(scope).catch(() => null)) ?? { scopeName: scope, patterns: [] };
      return parseRawGrammar(JSON.stringify(raw), `${scope}.json`);
    },
  });
  return registry;
}

/** Loads (once per window) the TextMate grammar for a language, plus any grammars it embeds. */
export function loadGrammar(languageId: string): Promise<IGrammar | null> {
  let pending = grammars.get(languageId);
  if (!pending) {
    pending = (async () => {
      const raw = (await window.saturn.languages.grammar(languageId)) as RawGrammar | null;
      return raw ? sharedRegistry().loadGrammar(raw.scopeName) : null;
    })();
    grammars.set(languageId, pending);
  }
  return pending;
}

/** Forgets loaded grammars, e.g. after modules changed. */
export function clearGrammars(): void {
  grammars.clear();
  registry?.dispose();
  registry = null;
}

/** "keyword" matches "keyword" and "keyword.control.cs", but not "keywords". */
function scopeMatches(scope: string, selector: string): boolean {
  return scope === selector || scope.startsWith(`${selector}.`);
}

/**
 * How well a rule matches the scope at `index` (higher is more specific), or -1. A rule's scope may
 * name ancestors first, space-separated ("comment.block.documentation entity.name.tag"): the last
 * part must match this scope and the others must match outer scopes, in order.
 */
function specificity(rule: SyntaxRule, scopes: string[], index: number): number {
  const parts = rule.scope.trim().split(/\s+/);
  if (!scopeMatches(scopes[index], parts[parts.length - 1])) return -1;
  let outer = index - 1;
  for (let p = parts.length - 2; p >= 0; p--) {
    while (outer >= 0 && !scopeMatches(scopes[outer], parts[p])) outer--;
    if (outer < 0) return -1;
    outer--;
  }
  return parts.length * 1000 + parts[parts.length - 1].length;
}

/**
 * A token's style, VS Code style: scopes are checked from innermost outwards and each picks its most
 * specific rule. Colour and font style are taken separately from the innermost rule that sets each, so
 * a rule without a colour (e.g. string quotes) keeps the surrounding colour.
 */
function styleFor(scopes: string[], rules: SyntaxRule[]): SyntaxRule | null {
  let color: string | undefined;
  let fontStyle: string | undefined;
  for (let i = scopes.length - 1; i >= 0 && (color === undefined || fontStyle === undefined); i--) {
    let best: SyntaxRule | null = null;
    let bestScore = -1;
    for (const rule of rules) {
      const score = specificity(rule, scopes, i);
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    }
    if (!best) continue;
    color ??= best.color;
    fontStyle ??= best.fontStyle;
  }
  return color === undefined && !fontStyle ? null : { scope: '', color, fontStyle };
}

const themeChanged = StateEffect.define<null>();
const markCache = new Map<string, Decoration>();

function cssFor(rule: SyntaxRule): string {
  const styles = new Set((rule.fontStyle ?? '').split(/\s+/));
  const lines = [styles.has('underline') && 'underline', styles.has('strikethrough') && 'line-through'].filter(Boolean);
  return [
    rule.color && `color: ${resolveColor(rule.color)};`,
    styles.has('bold') && 'font-weight: 600;',
    styles.has('italic') && 'font-style: italic;',
    lines.length > 0 && `text-decoration: ${lines.join(' ')};`,
  ].filter(Boolean).join(' ');
}

function markFor(rule: SyntaxRule): Decoration {
  const key = `${rule.color}|${rule.fontStyle ?? ''}`;
  let mark = markCache.get(key);
  if (!mark) {
    mark = Decoration.mark({ attributes: { style: cssFor(rule) } });
    markCache.set(key, mark);
  }
  return mark;
}

export async function highlightText(languageId: string, text: string): Promise<{ from: number; to: number; style: string }[]> {
  const grammar = await loadGrammar(languageId).catch(() => null);
  if (!grammar) return [];
  const rules = activeTheme()?.syntax ?? [];
  const spans: { from: number; to: number; style: string }[] = [];
  let state: StateStack = INITIAL;
  let offset = 0;
  for (const line of text.split('\n').slice(0, MAX_LINES)) {
    const result = grammar.tokenizeLine(line, state);
    for (const token of result.tokens) {
      const rule = styleFor(token.scopes, rules);
      const end = Math.min(token.endIndex, line.length);
      if (rule && end > token.startIndex) spans.push({ from: offset + token.startIndex, to: offset + end, style: cssFor(rule) });
    }
    state = result.ruleStack;
    offset += line.length + 1;
  }
  return spans;
}

const scopeMarks = new Map<string, Decoration | null>();

function markForScopes(scopes: string[], rules: SyntaxRule[]): Decoration | null {
  const key = scopes.join(' ');
  let mark = scopeMarks.get(key);
  if (mark === undefined) {
    const rule = styleFor(scopes, rules);
    mark = rule ? markFor(rule) : null;
    scopeMarks.set(key, mark);
  }
  return mark;
}

export function semanticMark(scopes: string[]): Decoration | null {
  return markForScopes(scopes, activeTheme()?.syntax ?? []);
}

export function isThemeChange(update: ViewUpdate): boolean {
  return update.transactions.some((t) => t.effects.some((e) => e.is(themeChanged)));
}

interface LineTokens {
  marks: { from: number; to: number; mark: Decoration }[];
  end: StateStack;
}

const tokenizers = new WeakMap<EditorView, { grammar: IGrammar; lines: LineTokens[] }>();

/** Whether the text just before `pos` is inside a comment, going by the view's grammar. */
export function inComment(view: EditorView, pos: number): boolean {
  const entry = tokenizers.get(view);
  if (!entry) return false;
  const line = view.state.doc.lineAt(pos);
  const start = line.number > 1 ? entry.lines[line.number - 2]?.end : INITIAL;
  if (!start) return false;
  const column = pos - line.from;
  const { tokens } = entry.grammar.tokenizeLine(line.text, start);
  const token = tokens.find((t) => t.startIndex < column && column <= t.endIndex) ?? tokens[tokens.length - 1];
  return !!token?.scopes.some((s) => s === 'comment' || s.startsWith('comment.'));
}

export function textMateHighlighting(grammar: IGrammar): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      lines: LineTokens[] = [];

      constructor(view: EditorView) {
        tokenizers.set(view, this.entry);
        this.retokenize(view, 0, []);
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        const recolour = update.transactions.some((t) => t.effects.some((e) => e.is(themeChanged)));
        if (recolour) {
          markCache.clear();
          scopeMarks.clear();
          this.lines = [];
          this.retokenize(update.view, 0, []);
        } else if (update.docChanged) {
          const oldDoc = update.startState.doc;
          const newDoc = update.state.doc;
          let first = Infinity;
          let lastOld = 0;
          let lastNew = 0;
          update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
            first = Math.min(first, oldDoc.lineAt(fromA).number - 1);
            lastOld = Math.max(lastOld, oldDoc.lineAt(toA).number - 1);
            lastNew = Math.max(lastNew, newDoc.lineAt(toB).number - 1);
          });
          const old = this.lines;
          this.lines = old.slice(0, first);
          this.retokenize(update.view, first, old, lastNew, lastNew - lastOld);
        } else return;
        this.decorations = this.build(update.view);
      }

      get entry() {
        const plugin = this;
        return { grammar, get lines() { return plugin.lines; } };
      }

      retokenize(view: EditorView, from: number, old: LineTokens[], settleAfter = -1, shift = 0) {
        const rules = activeTheme()?.syntax ?? [];
        const doc = view.state.doc;
        const count = Math.min(doc.lines, MAX_LINES);
        if (this.lines.length > count) this.lines.length = count;
        from = Math.min(from, this.lines.length);
        let state = from > 0 ? this.lines[from - 1].end : INITIAL;
        for (let i = from; i < count; i++) {
          const line = doc.line(i + 1);
          const result = grammar.tokenizeLine(line.text, state);
          const marks: LineTokens['marks'] = [];
          for (const token of result.tokens) {
            const mark = markForScopes(token.scopes, rules);
            const end = Math.min(token.endIndex, line.length);
            if (mark && end > token.startIndex) marks.push({ from: token.startIndex, to: end, mark });
          }
          this.lines.push({ marks, end: result.ruleStack });
          state = result.ruleStack;
          const previous = old[i - shift];
          if (i > settleAfter && settleAfter >= 0 && previous && previous.end.equals(state)) {
            this.lines.push(...old.slice(i - shift + 1, i - shift + 1 + (count - i - 1)));
            if (this.lines.length === count) return;
            state = this.lines[this.lines.length - 1].end;
            i = this.lines.length - 1;
          }
        }
      }

      build(view: EditorView): DecorationSet {
        const doc = view.state.doc;
        const builder = new RangeSetBuilder<Decoration>();
        this.lines.forEach((tokens, i) => {
          const start = doc.line(i + 1).from;
          for (const m of tokens.marks) builder.add(start + m.from, start + m.to, m.mark);
        });
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Asks every editor view to recolour after a theme change. */
export function refreshHighlighting(view: EditorView): void {
  view.dispatch({ effects: themeChanged.of(null) });
}
