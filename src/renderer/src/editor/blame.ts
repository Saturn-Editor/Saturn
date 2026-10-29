import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, type BlockInfo } from '@codemirror/view';
import type { BlameLine } from '@shared/types';

interface Blame {
  lines: BlameLine[];
  open: (hash: string) => void;
}

const setBlame = StateEffect.define<Blame | null>();

const blameField = StateField.define<Blame | null>({
  create: () => null,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setBlame) ? e.value : v), value),
});

const shortDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

class BlameMarker extends GutterMarker {
  constructor(readonly line: BlameLine, readonly first: boolean) {
    super();
  }

  eq(other: BlameMarker) {
    return other.line.hash === this.line.hash && other.first === this.first;
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-saturn-blame-line';
    el.title = `${this.line.author}, ${shortDate.format(this.line.time)}\n${this.line.summary}`;
    if (this.first) el.textContent = `${shortDate.format(this.line.time)}  ${this.line.author}`;
    return el;
  }
}

const blameGutter = gutter({
  class: 'cm-saturn-blame',
  markers(view) {
    const blame = view.state.field(blameField);
    if (!blame) return RangeSet.empty;
    const markers = [];
    for (let n = 1; n <= view.state.doc.lines && n <= blame.lines.length; n++) {
      const line = blame.lines[n - 1];
      markers.push(new BlameMarker(line, n === 1 || blame.lines[n - 2].hash !== line.hash).range(view.state.doc.line(n).from));
    }
    return RangeSet.of(markers);
  },
  domEventHandlers: {
    click(view, block: BlockInfo) {
      const blame = view.state.field(blameField);
      const line = blame?.lines[view.state.doc.lineAt(block.from).number - 1];
      if (!blame || !line || /^0+$/.test(line.hash)) return false;
      blame.open(line.hash);
      return true;
    },
  },
});

const blameTheme = EditorView.theme({
  '.cm-saturn-blame-line': {
    width: '22ch',
    padding: '0 8px',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    color: 'var(--saturn-muted)',
    cursor: 'pointer',
  },
});

export const blameExtension = [blameField, blameGutter, blameTheme];

export function blameShown(view: EditorView): boolean {
  return view.state.field(blameField, false) != null;
}

export async function toggleBlame(view: EditorView, relativePath: string, open: (hash: string) => void): Promise<void> {
  if (blameShown(view)) {
    view.dispatch({ effects: setBlame.of(null) });
    return;
  }
  const lines = await window.saturn.git.blame(relativePath);
  view.dispatch({ effects: setBlame.of({ lines, open }) });
}
