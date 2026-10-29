import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';

export const setCoverageLines = StateEffect.define<{ covered: number[]; uncovered: number[] } | null>();

const coverageField = StateField.define<{ covered: number[]; uncovered: number[] } | null>({
  create: () => null,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setCoverageLines) ? e.value : v), value),
});

class Bar extends GutterMarker {
  constructor(readonly covered: boolean) {
    super();
  }

  eq(other: Bar) {
    return other.covered === this.covered;
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = this.covered ? 'cm-saturn-covered' : 'cm-saturn-uncovered';
    el.title = this.covered ? 'Run by tests' : 'Not run by tests';
    return el;
  }
}

const covered = new Bar(true);
const uncovered = new Bar(false);

const coverageGutter = gutter({
  class: 'cm-saturn-coverage',
  markers(view) {
    const lines = view.state.field(coverageField);
    if (!lines) return RangeSet.empty;
    const doc = view.state.doc;
    const marks = [
      ...lines.covered.map((n) => [n, covered] as const),
      ...lines.uncovered.map((n) => [n, uncovered] as const),
    ].filter(([n]) => n >= 1 && n <= doc.lines).sort(([a], [b]) => a - b);
    return RangeSet.of(marks.map(([n, bar]) => bar.range(doc.line(n).from)));
  },
});

const coverageTheme = EditorView.theme({
  '.cm-saturn-covered, .cm-saturn-uncovered': { width: '3px', height: '100%', marginLeft: '2px' },
  '.cm-saturn-covered': { backgroundColor: 'var(--color-green-500)' },
  '.cm-saturn-uncovered': { backgroundColor: 'var(--saturn-error)' },
});

export const coverageExtension = [coverageField, coverageGutter, coverageTheme];
