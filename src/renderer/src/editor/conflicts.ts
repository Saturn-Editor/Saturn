import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

/** A Git conflict block: <<<<<<< ours ||||||| base (optional) ======= theirs >>>>>>> */
interface Conflict {
  /** Start of the "<<<<<<<" line. */
  from: number;
  /** End of the ">>>>>>>" line, including its line break if there is one. */
  to: number;
  ours: string;
  theirs: string;
  oursLines: [number, number];
  theirsLines: [number, number];
}

function findConflicts(state: EditorState): Conflict[] {
  const doc = state.doc;
  if (!doc.toString().includes('<<<<<<<')) return [];
  const found: Conflict[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (!doc.line(n).text.startsWith('<<<<<<<')) continue;
    let base = 0;
    let mid = 0;
    let end = 0;
    for (let m = n + 1; m <= doc.lines; m++) {
      const text = doc.line(m).text;
      if (text.startsWith('<<<<<<<')) break;
      if (!mid && !base && text.startsWith('|||||||')) base = m;
      else if (!mid && text.startsWith('=======')) mid = m;
      else if (mid && text.startsWith('>>>>>>>')) {
        end = m;
        break;
      }
    }
    if (!mid || !end) continue;
    const lines = (a: number, b: number) => (a > b ? '' : doc.sliceString(doc.line(a).from, doc.line(b).to));
    const oursEnd = (base || mid) - 1;
    found.push({
      from: doc.line(n).from,
      to: end < doc.lines ? doc.line(end + 1).from : doc.line(end).to,
      ours: lines(n + 1, oursEnd),
      theirs: lines(mid + 1, end - 1),
      oursLines: [n + 1, oursEnd],
      theirsLines: [mid + 1, end - 1],
    });
    n = end;
  }
  return found;
}

class ConflictActions extends WidgetType {
  constructor(private readonly conflict: Conflict) {
    super();
  }

  eq(other: ConflictActions) {
    return other.conflict.from === this.conflict.from && other.conflict.to === this.conflict.to;
  }

  toDOM(view: EditorView) {
    const bar = document.createElement('div');
    bar.className = 'cm-saturn-conflict-actions';
    bar.dataset.testid = 'conflict-actions';
    const { from, to, ours, theirs } = this.conflict;
    const trailing = view.state.sliceDoc(to - 1, to) === '\n' ? '\n' : '';
    const choices: [string, string][] = [
      ['Accept current', ours],
      ['Accept incoming', theirs],
      ['Accept both', [ours, theirs].filter(Boolean).join('\n')],
    ];
    for (const [label, text] of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onmousedown = (e) => {
        e.preventDefault();
        const insert = text ? text + trailing : '';
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from } });
      };
      bar.append(button);
    }
    return bar;
  }

  ignoreEvent() {
    return false;
  }
}

const oursLine = Decoration.line({ class: 'cm-saturn-conflict-ours' });
const theirsLine = Decoration.line({ class: 'cm-saturn-conflict-theirs' });
const markerLine = Decoration.line({ class: 'cm-saturn-conflict-marker' });

function decorate(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  for (const c of findConflicts(state)) {
    ranges.push(Decoration.widget({ widget: new ConflictActions(c), side: -1, block: true }).range(c.from));
    const [o1, o2] = c.oursLines;
    const [t1, t2] = c.theirsLines;
    ranges.push(markerLine.range(doc.line(o1 - 1).from));
    for (let n = o1; n <= o2; n++) ranges.push(oursLine.range(doc.line(n).from));
    // The base section (diff3) and "=======" read as markers.
    for (let n = o2 + 1; n < t1; n++) ranges.push(markerLine.range(doc.line(n).from));
    for (let n = t1; n <= t2; n++) ranges.push(theirsLine.range(doc.line(n).from));
    ranges.push(markerLine.range(doc.line(t2 + 1).from));
  }
  return Decoration.set(ranges, true);
}

/** Git conflict blocks in a file: both sides tinted, with Accept current / incoming / both above each. */
export const conflictMarkers = StateField.define<DecorationSet>({
  create: decorate,
  update: (decorations, tr) => (tr.docChanged ? decorate(tr.state) : decorations),
  provide: (f) => EditorView.decorations.from(f),
});
