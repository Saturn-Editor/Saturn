import {
  copyLineDown, defaultKeymap, deleteLine, history, historyKeymap, indentWithTab, insertNewline, moveLineDown, moveLineUp,
} from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type Command,
} from '@codemirror/view';
import { actionForKey } from '@renderer/commands/keymap';
import { goToDefinition } from '@renderer/modules/languageServer';

/** Plan 3 puts language support (highlighting, completion) in here; the core leaves it empty. */
export const languageCompartment = new Compartment();

/** Settings → Behaviour. New editor states read it; ModuleBridge rebuilds open editors when it changes. */
export const editorBehaviour = { autoIndent: true, indentWith: 'spaces' as 'spaces' | 'tab', indentSize: 4 };

function behaviourExtensions() {
  const { autoIndent, indentWith, indentSize } = editorBehaviour;
  return [
    indentUnit.of(indentWith === 'tab' ? '\t' : ' '.repeat(indentSize)),
    EditorState.tabSize.of(indentSize),
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
  'editor.duplicateLine': copyLineDown,
  'editor.deleteLine': deleteLine,
  'editor.moveLineUp': moveLineUp,
  'editor.moveLineDown': moveLineDown,
};

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

/** Builds the state for one plain-text document. */
export function createEditorState(text: string, callbacks: EditorCallbacks): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      bracketMatching(),
      search({ top: false }),
      highlightSelectionMatches(),
      languageCompartment.of([]),
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
