import {
  copyLineDown, defaultKeymap, deleteLine, history, historyKeymap, indentLess, indentMore, insertNewline, moveLineDown, moveLineUp,
} from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type Command,
} from '@codemirror/view';
import { actionForKey } from '@renderer/commands/keymap';
import { toggleBreakpoint } from './breakpoints';
import { conflictMarkers } from './conflicts';
import { findReferences, formatDocument, goToDefinition, quickFix, renameSymbol } from '@renderer/modules/languageServer';
import { blameExtension } from './blame';
import { testGutterExtension } from './testGutter';
import { coverageExtension } from './coverageGutter';

/** Plan 3 puts language support (highlighting, completion) in here; the core leaves it empty. */
export const languageCompartment = new Compartment();

/** Settings → Behaviour. New editor states read it; ModuleBridge rebuilds open editors when it changes. */
export const editorBehaviour = { autoIndent: true, indentWith: 'spaces' as 'spaces' | 'tab', indentSize: 4, autoCloseBrackets: true };

/** Brackets and quotes that close themselves (user's choice includes <). */
const CLOSING_PAIRS = ['(', '[', '{', '<', "'", '"'];

const OPEN_CLOSE: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

const openPair: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const before = state.sliceDoc(line.from, range.head);
  const after = state.sliceDoc(range.head, line.to);
  const open = before.match(/([{[(])\s*$/);
  const close = after.match(/^\s*([}\])])/);
  if (!open || !close || OPEN_CLOSE[open[1]] !== close[1]) return false;
  const from = line.from + open.index! + 1;
  const to = range.head + close[0].length - 1;
  const base = line.text.match(/^\s*/)![0];
  const inner = `${base}${state.facet(indentUnit)}`;
  view.dispatch({
    changes: { from, to, insert: `\n${inner}\n${base}` },
    selection: { anchor: from + 1 + inner.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
};

const tabKey: Command = (view) => {
  const { state } = view;
  const midLine = state.selection.ranges.every((r) => r.empty && /\S/.test(state.sliceDoc(state.doc.lineAt(r.head).from, r.head)));
  if (!midLine) return indentMore(view);
  view.dispatch(state.update(state.replaceSelection(state.facet(indentUnit)), { scrollIntoView: true, userEvent: 'input' }));
  return true;
};

const duplicate: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.every((r) => r.empty)) return copyLineDown(view);
  view.dispatch(state.update(state.changeByRange((r) => {
    if (r.empty) return { range: r };
    const text = state.sliceDoc(r.from, r.to);
    return { changes: { from: r.to, insert: text }, range: EditorSelection.range(r.to, r.to + text.length) };
  }), { scrollIntoView: true, userEvent: 'input.copy' }));
  return true;
};

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
    ...(autoIndent ? [Prec.high(keymap.of([{ key: 'Enter', run: openPair }]))] : [Prec.high(keymap.of([{ key: 'Enter', run: insertNewline }]))]),
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
  // As specific as CodeMirror's own focused rule (a light lavender), or that wins and hides light text.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--saturn-selection)' },
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
  '.cm-saturn-hover-rich': { whiteSpace: 'normal', fontFamily: 'var(--font-ui)', lineHeight: '1.5', padding: '6px 10px' },
  '.cm-saturn-hover-rich > :first-child': { marginTop: '0' },
  '.cm-saturn-hover-rich > :last-child': { marginBottom: '0' },
  '.cm-saturn-hover-rich p': { margin: '6px 0' },
  '.cm-saturn-hover-rich pre': { margin: '6px -10px', padding: '6px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', backgroundColor: 'var(--saturn-editor)', borderTop: '1px solid var(--saturn-divider)', borderBottom: '1px solid var(--saturn-divider)' },
  '.cm-saturn-hover-rich > pre:first-child': { marginTop: '-6px', borderTop: 'none' },
  '.cm-saturn-hover-rich > pre:last-child': { marginBottom: '-6px', borderBottom: 'none' },
  '.cm-saturn-hover-rich code': { fontFamily: 'var(--font-mono)', fontSize: '0.92em', color: 'var(--saturn-strong)' },
  '.cm-saturn-hover-rich strong': { color: 'var(--saturn-strong)', fontWeight: '600' },
  '.cm-saturn-hover-rich ul, .cm-saturn-hover-rich ol': { margin: '6px 0', paddingLeft: '18px' },
  '.cm-saturn-hover-rich hr': { border: 'none', borderTop: '1px solid var(--saturn-divider)', margin: '6px -10px' },
  '.cm-saturn-hover-rich blockquote': { margin: '6px 0', paddingLeft: '8px', borderLeft: '2px solid var(--saturn-border)', color: 'var(--saturn-muted)' },
  '.cm-saturn-hover-heading': { fontWeight: '600', color: 'var(--saturn-strong)', margin: '6px 0' },
  '.cm-saturn-hover-link': { color: 'var(--saturn-accent)' },
  '.cm-saturn-parameter': { color: 'var(--saturn-accent)' },
  '.cm-saturn-signature-doc': { marginTop: '4px', color: 'var(--saturn-muted)', whiteSpace: 'pre-wrap' },
  '.cm-saturn-inlay': { color: 'var(--saturn-muted)', fontSize: '0.9em', opacity: '0.85' },
  '.cm-saturn-codelens': { color: 'var(--saturn-muted)', fontSize: '0.85em', lineHeight: '1.4', fontFamily: 'var(--font-ui)' },
  '.cm-saturn-codelens button': { background: 'none', border: 'none', padding: '0', color: 'inherit', font: 'inherit', cursor: 'pointer' },
  '.cm-saturn-codelens button:hover': { color: 'var(--saturn-accent)', textDecoration: 'underline' },
  '.cm-saturn-bulb': { display: 'inline-flex', alignItems: 'center', marginLeft: '6px', color: 'var(--color-amber-500)', cursor: 'pointer', verticalAlign: 'middle' },  '.cm-saturn-diagnostic-fixes': { marginTop: '4px', padding: '0', background: 'none', border: 'none', color: 'var(--saturn-accent)', font: 'inherit', cursor: 'pointer' },
  '.cm-saturn-diagnostic-fixes:hover': { textDecoration: 'underline' },
  '.cm-saturn-quickfix': { display: 'flex', flexDirection: 'column', padding: '2px 0', minWidth: '240px', maxHeight: '320px', overflow: 'auto' },
  '.cm-saturn-quickfix button': { textAlign: 'left', padding: '2px 8px', background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', outline: 'none' },
  '.cm-saturn-quickfix button:hover, .cm-saturn-quickfix button:focus': { backgroundColor: 'var(--saturn-selection)', color: 'var(--saturn-strong)' },
  '.cm-saturn-rename': { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px' },
  '.cm-saturn-rename input': { width: '240px', padding: '2px 6px', outline: 'none' },
  '.cm-saturn-breakpoints .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '14px', cursor: 'pointer' },
  '.cm-saturn-breakpoint': { width: '9px', height: '9px', borderRadius: '50%', backgroundColor: 'var(--color-red-500)' },
  // Conditional: a bar across the dot. Logpoint: a diamond (it logs instead of stopping).
  '.cm-saturn-conditional': { backgroundImage: 'linear-gradient(transparent 40%, var(--saturn-editor) 40%, var(--saturn-editor) 60%, transparent 60%)' },
  '.cm-saturn-logpoint': { borderRadius: '0', transform: 'rotate(45deg) scale(0.85)' },
  '.cm-saturn-disabled': { backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'inset 0 0 0 1.5px var(--color-red-500)' },
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
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--color-amber-500)' },
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
  'editor.quickFix': (view) => quickFix(view),
  'editor.formatDocument': (view) => {
    void formatDocument(view);
    return true;
  },
  'editor.toggleBreakpoint': (view) => toggleBreakpoint(view),
  'editor.duplicateLine': duplicate,
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
      blameExtension,
      testGutterExtension,
      coverageExtension,
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
        { key: 'Tab', run: tabKey, shift: indentLess },
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
