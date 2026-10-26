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
 * installed language provides it; if none does, that part is simply left uncoloured.
 */
function sharedRegistry(): Registry {
  registry ??= new Registry({
    onigLib: loadOniguruma().then(() => ({
      createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
      createOnigString: (s: string) => new OnigString(s),
    })),
    loadGrammar: async (scope) => {
      const raw = await window.saturn.modules.grammarByScope(scope).catch(() => null);
      return raw ? parseRawGrammar(JSON.stringify(raw), `${scope}.json`) : null;
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

/**
 * The theme rule for a token's scopes: the innermost scope that matches a rule wins, and a rule
 * matches a scope equal to it or starting with it plus "." (so "keyword" matches "keyword.control").
 */
function ruleFor(scopes: string[], rules: SyntaxRule[]): SyntaxRule | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    let best: SyntaxRule | null = null;
    for (const rule of rules) {
      if ((scopes[i] === rule.scope || scopes[i].startsWith(`${rule.scope}.`)) && (!best || rule.scope.length > best.scope.length)) best = rule;
    }
    if (best) return best;
  }
  return null;
}

const themeChanged = StateEffect.define<null>();
const markCache = new Map<string, Decoration>();

function markFor(rule: SyntaxRule): Decoration {
  const key = `${rule.color}|${rule.fontStyle ?? ''}`;
  let mark = markCache.get(key);
  if (!mark) {
    const style = `color: ${resolveColor(rule.color)};${rule.fontStyle === 'italic' ? ' font-style: italic;' : ''}${rule.fontStyle === 'bold' ? ' font-weight: 600;' : ''}`;
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
        const rule = ruleFor(token.scopes, rules);
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
