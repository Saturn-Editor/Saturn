import { snippet, type Completion } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export function docComments(path: string, languageId: string, triggers: string[]): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged || !update.transactions.some((tr) => tr.isUserEvent('input.type'))) return;
    const { state, view } = update;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const before = state.sliceDoc(line.from, head);
    const indent = before.match(/^\s*/)![0];
    const trigger = triggers.find((t) => before.slice(indent.length) === t);
    if (!trigger || state.sliceDoc(head, line.to).trim()) return;
    const text = state.doc.toString();
    void window.saturn.modules.docComment(languageId, { path, text, line: line.number - 1, trigger, indent }).then((comment) => {
      if (!comment || view.state.doc.toString() !== text) return;
      const from = line.from + indent.length;
      snippet(comment.replace(/\$(\d+)/g, '${$1}'))(view, null as unknown as Completion, from, head);
    }, () => undefined);
  });
}
