import {
  copyLineDown, defaultKeymap, deleteLine, history, historyKeymap, indentWithTab, insertNewline, moveLineDown, moveLineUp,
} from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type Command,
} from '@codemirror/view';
import { actionForKey } from '@renderer/commands/keymap';
import { toggleBreakpoint } from './breakpoints';
import { conflictMarkers } from './conflicts';
import { findReferences, formatDocument, goToDefinition, renameSymbol } from '@renderer/modules/languageServer';

/** Plan 3 puts language support (highlighting, completion) in here; the core leaves it empty. */
export const languageCompartment = new Compartment();

/** Settings → Behaviour. New editor states read it; ModuleBridge rebuilds open editors when it changes. */
export const editorBehaviour = { autoIndent: true, indentWith: 'spaces' as 'spaces' | 'tab', indentSize: 4, autoCloseBrackets: true };

/** Brackets and quotes that close themselves (user's choice includes <). */
const CLOSING_PAIRS = ['(', '[', '{', '<', "'", '"'];

function behaviourExtensions() {
  const { autoIndent, indentWith, indentSize, autoCloseBrackets } = editorBehaviour;
  return [
    indentUnit.of(indentWith === 'tab' ? '\t' : ' '.repeat(indentSize)),
    EditorState.tabSize.of(indentSize),
    // Typing an opener adds its closer; Enter between a pair puts the closer on its own line, indented
    // (CodeMirror's Enter does that when auto-indent is on).
    ...(autoCloseBrackets ? [
      closeBrackets(),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: CLOSING_PAIRS } }]),
      keymap.of(closeBracketsKeymap),
    ] : []),
    // Without auto-indent, Enter starts the new line at the left edge.
    ...(autoIndent ? [] : [Prec.high(keymap.of([{ key: 'Enter', run: insertNewline }]))]),
  ];
}

/** Colours come from the active theme's CSS variables, so theme switches restyle the editor live. */
const saturnTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--saturn-editor)', color: 'var(--saturn-text)', fontSize: '12px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--saturn-accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--saturn-accent)' },
  '.cm-gutters': { backgroundColor: 'var(--saturn-editor)', color: 'var(--saturn-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--saturn-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--saturn-hover)', color: 'var(--saturn-strong)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--saturn-selection)' },
  '.cm-matchingBracket': { outline: '1px solid var(--saturn-border)', backgroundColor: 'transparent' },
  '.cm-panels': { backgroundColor: 'var(--saturn-panel)', color: 'var(--saturn-text)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--saturn-divider)' },
  '.cm-textfield': { backgroundColor: 'var(--saturn-editor)', border: '1px solid var(--saturn-border)', color: 'var(--saturn-strong)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--saturn-panel)', border: '1px solid var(--saturn-border)', color: 'var(--saturn-strong)' },
  '.cm-searchMatch': { backgroundColor: 'var(--saturn-selection)' },
  // Popups (autocomplete and other tooltips) follow the theme instead of CodeMirror's light default.
  '.cm-tooltip': { backgroundColor: 'var(--saturn-raised)', color: 'var(--saturn-text)', border: '1px solid var(--saturn-border)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--saturn-selection)', color: 'var(--saturn-strong)' },
  '.cm-completionDetail': { color: 'var(--saturn-muted)', fontStyle: 'normal', marginLeft: '12px' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--saturn-accent)' },
  '.cm-completionInfo': { backgroundColor: 'var(--saturn-raised)', border: '1px solid var(--saturn-border)' },
  // Language-server hover text and diagnostics popups.
  '.cm-saturn-hover': { padding: '4px 8px', maxWidth: '560px', maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' },
  '.cm-saturn-parameter': { color: 'var(--saturn-accent)' },
  '.cm-saturn-signature-doc': { marginTop: '4px', color: 'var(--saturn-muted)', whiteSpace: 'pre-wrap' },
  '.cm-saturn-rename': { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px' },
  '.cm-saturn-rename input': { width: '240px', padding: '2px 6px', outline: 'none' },
  '.cm-saturn-breakpoints .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '14px', cursor: 'pointer' },
  '.cm-saturn-breakpoint': { width: '9px', height: '9px', borderRadius: '50%', backgroundColor: 'var(--color-red-500)' },
  // Conditional: a bar across the dot. Logpoint: a diamond (it logs instead of stopping).
  '.cm-saturn-conditional': { backgroundImage: 'linear-gradient(transparent 40%, var(--saturn-editor) 40%, var(--saturn-editor) 60%, transparent 60%)' },
  '.cm-saturn-logpoint': { borderRadius: '0', transform: 'rotate(45deg) scale(0.85)' },
  '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer' },
  '.cm-saturn-execution': { backgroundColor: 'color-mix(in srgb, var(--saturn-accent) 22%, transparent)' },
  '.cm-saturn-conflict-ours': { backgroundColor: 'color-mix(in srgb, var(--color-green-500) 14%, transparent)' },
  '.cm-saturn-conflict-theirs': { backgroundColor: 'color-mix(in srgb, var(--color-sky-500) 14%, transparent)' },
  '.cm-saturn-conflict-marker': { color: 'var(--saturn-muted)' },
  '.cm-saturn-conflict-actions': { display: 'flex', gap: '12px', padding: '2px 4px', fontFamily: 'inherit' },
  '.cm-saturn-conflict-actions button': { color: 'var(--saturn-muted)', background: 'none', border: 'none', padding: '0', cursor: 'pointer' },
  '.cm-saturn-conflict-actions button:hover': { color: 'var(--saturn-accent)' },
  '.cm-diagnostic': { padding: '4px 8px', borderLeftWidth: '3px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--color-red-500)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--saturn-accent)' },
  '.cm-diagnostic-info, .cm-diagnostic-hint': { borderLeftColor: 'var(--saturn-muted)' },
});

export interface EditorCallbacks {
  onChange: (text: string) => void;
  onCursor: (label: string) => void;
}

const EDITOR_COMMANDS: Record<string, Command> = {
  'editor.find': openSearchPanel,
  'editor.replace': openSearchPanel,
  'editor.gotoLine': gotoLine,
  'editor.gotoDefinition': (view) => goToDefinition(view),
  'editor.findReferences': (view) => findReferences(view),
  'editor.rename': (view) => renameSymbol(view),
  'editor.formatDocument': (view) => {
    void formatDocument(view);
    return true;
  },
  'editor.toggleBreakpoint': (view) => toggleBreakpoint(view),
  'editor.duplicateLine': copyLineDown,
  'editor.deleteLine': deleteLine,
  'editor.moveLineUp': moveLineUp,
  'editor.moveLineDown': moveLineDown,
};

/** Runs an editor command (as in the keymap) on a view, e.g. from the right-click menu. */
export function runEditorCommand(id: string, view: EditorView): void {
  EDITOR_COMMANDS[id]?.(view);
}

/**
 * The chosen keymap's editor shortcuts (Settings → Keymap). It looks the keymap up on every key press,
 * so switching keymaps applies to open files at once; it runs before CodeMirror's own default keys.
 */
const keymapShortcuts = Prec.high(EditorView.domEventHandlers({
  keydown(e, view) {
    const id = actionForKey(e, 'editor');
    const command = id ? EDITOR_COMMANDS[id] : undefined;
    if (!command) return false;
    e.preventDefault();
    command(view);
    return true;
  },
}));

/** Builds the state for one plain-text document; `before` goes ahead of the line numbers (the breakpoint column). */
export function createEditorState(text: string, callbacks: EditorCallbacks, before: Extension = []): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      before,
      // Clicking a line number adds or removes a breakpoint there.
      lineNumbers({ domEventHandlers: { mousedown: (view, line, e) => (e as MouseEvent).button === 0 && toggleBreakpoint(view, line.from) } }),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      bracketMatching(),
      search({ top: false }),
      highlightSelectionMatches(),
      languageCompartment.of([]),
      conflictMarkers,
      keymapShortcuts,
      behaviourExtensions(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      saturnTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) callbacks.onCursor(cursorLabel(update.state));
      }),
    ],
  });
}

/** "<line>:<column>" for the main cursor, both 1-based. */
export function cursorLabel(state: EditorState): string {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return `${line.number}:${head - line.from + 1}`;
}
