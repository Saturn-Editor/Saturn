import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';
import { INITIAL, parseRawGrammar, Registry, type IGrammar, type StateStack } from 'vscode-textmate';
import type { SyntaxRule } from '@shared/types';
import { activeTheme, resolveColor } from '@renderer/theme/ThemeApplier';

/**
 * Lines past this are left uncoloured, so huge files stay responsive. The whole file is
 * re-tokenized on each change; caching per-line grammar state is a later optimisation.
 */
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
      const raw = (await window.saturn.modules.grammarByScope(scope).catch(() => null)) ?? { scopeName: scope, patterns: [] };
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
      const raw = (await window.saturn.modules.grammar(languageId)) as RawGrammar | null;
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

function markFor(rule: SyntaxRule): Decoration {
  const key = `${rule.color}|${rule.fontStyle ?? ''}`;
  let mark = markCache.get(key);
  if (!mark) {
    const styles = new Set((rule.fontStyle ?? '').split(/\s+/));
    const lines = [styles.has('underline') && 'underline', styles.has('strikethrough') && 'line-through'].filter(Boolean);
    const style = [
      rule.color && `color: ${resolveColor(rule.color)};`,
      styles.has('bold') && 'font-weight: 600;',
      styles.has('italic') && 'font-style: italic;',
      lines.length > 0 && `text-decoration: ${lines.join(' ')};`,
    ].filter(Boolean).join(' ');
    mark = Decoration.mark({ attributes: { style } });
    markCache.set(key, mark);
  }
  return mark;
}

/** CodeMirror highlighting driven by a TextMate grammar and the active theme's syntax rules. */
export function textMateHighlighting(grammar: IGrammar): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view);
      }

      update(update: ViewUpdate) {
        const recolour = update.transactions.some((t) => t.effects.some((e) => e.is(themeChanged)));
        if (recolour) markCache.clear();
        if (recolour || update.docChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (v) => v.decorations },
  );

  /** Tokenizes the whole document (up to MAX_LINES) and marks each token with its theme colour. */
  function build(view: EditorView): DecorationSet {
    const rules = activeTheme()?.syntax ?? [];
    const doc = view.state.doc;
    const builder = new RangeSetBuilder<Decoration>();
    let state: StateStack = INITIAL;
    for (let n = 1; n <= Math.min(doc.lines, MAX_LINES); n++) {
      const line = doc.line(n);
      const result = grammar.tokenizeLine(line.text, state);
      for (const token of result.tokens) {
        const rule = styleFor(token.scopes, rules);
        const end = Math.min(token.endIndex, line.length);
        if (rule && end > token.startIndex) builder.add(line.from + token.startIndex, line.from + end, markFor(rule));
      }
      state = result.ruleStack;
    }
    return builder.finish();
  }
}

/** Asks every editor view to recolour after a theme change. */
export function refreshHighlighting(view: EditorView): void {
  view.dispatch({ effects: themeChanged.of(null) });
}
