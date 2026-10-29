import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';

export interface TestLine {
  line: number;
  label: string;
  state?: 'running' | 'passed' | 'failed' | 'skipped';
  run: () => void;
}

export const setTestLines = StateEffect.define<TestLine[]>();

const testLines = StateField.define<TestLine[]>({
  create: () => [],
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setTestLines) ? e.value : v), value),
});

class RunMarker extends GutterMarker {
  constructor(readonly test: TestLine) {
    super();
  }

  eq(other: RunMarker) {
    return other.test.label === this.test.label && other.test.state === this.test.state;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-saturn-test cm-saturn-test-${this.test.state ?? 'none'}`;
    el.textContent = this.test.state === 'failed' ? '✕' : this.test.state === 'passed' ? '✓' : '▶';
    el.title = `Run ${this.test.label}${this.test.state ? ` (last run: ${this.test.state})` : ''}`;
    return el;
  }
}

const testRunGutter = gutter({
  class: 'cm-saturn-tests',
  markers(view) {
    const lines = view.state.field(testLines);
    const doc = view.state.doc;
    return RangeSet.of(lines.filter((t) => t.line >= 1 && t.line <= doc.lines).map((t) => new RunMarker(t).range(doc.line(t.line).from)), true);
  },
  domEventHandlers: {
    mousedown(view, block) {
      const line = view.state.doc.lineAt(block.from).number;
      const test = view.state.field(testLines).find((t) => t.line === line);
      if (!test) return false;
      test.run();
      return true;
    },
  },
});

const testTheme = EditorView.theme({
  '.cm-saturn-test': { display: 'inline-block', width: '14px', textAlign: 'center', cursor: 'pointer', fontSize: '10px' },
  '.cm-saturn-test-none, .cm-saturn-test-skipped, .cm-saturn-test-running': { color: 'var(--saturn-muted)' },
  '.cm-saturn-test-passed': { color: 'var(--color-green-500)' },
  '.cm-saturn-test-failed': { color: 'var(--saturn-error)' },
});

export const testGutterExtension = [testLines, testRunGutter, testTheme];
