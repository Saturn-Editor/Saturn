import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers,
} from '@codemirror/view';

/** Plan 3 puts language support (highlighting, completion) in here; the core leaves it empty. */
export const languageCompartment = new Compartment();

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
});

export interface EditorCallbacks {
  onChange: (text: string) => void;
  onSave: () => void;
  onCursor: (label: string) => void;
}

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
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => (callbacks.onSave(), true) },
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
