import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { WorkingDiff } from '@shared/types';
import { errorText } from '@renderer/helpers';

/** One line of a unified diff, with its old and new line numbers. */
interface DiffLine {
  kind: 'add' | 'remove' | 'same';
  text: string;
  oldLine?: number;
  newLine?: number;
}

interface Hunk {
  /** The text after "@@ … @@", usually the enclosing function. */
  title: string;
  lines: DiffLine[];
  /** The file header plus this hunk: a patch `git apply` accepts on its own. */
  patch: string;
}

const layout = signal<'unified' | 'split'>('split');
void window.saturn.settings.get().then((s) => (layout.value = s.diffLayout));
window.saturn.settings.onChanged((s) => (layout.value = s.diffLayout));

/** Parses a one-file unified diff (from `git diff` or `git show`) into hunks. */
function parse(diff: string): Hunk[] {
  const raw = diff.replace(/\n$/, '').split('\n');
  const firstHunk = raw.findIndex((l) => l.startsWith('@@'));
  if (firstHunk < 0) return [];
  const header = raw.slice(0, firstHunk).join('\n');
  const hunks: Hunk[] = [];
  let current: { title: string; lines: DiffLine[]; source: string[] } | null = null;
  let oldLine = 0;
  let newLine = 0;
  const finish = () => current && hunks.push({ title: current.title, lines: current.lines, patch: `${header}\n${current.source.join('\n')}\n` });
  for (const line of raw.slice(firstHunk)) {
    const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (at) {
      finish();
      oldLine = Number(at[1]);
      newLine = Number(at[2]);
      current = { title: at[3].trim(), lines: [], source: [line] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('diff --git')) break; // another file's diff; only the first is shown
    current.source.push(line);
    if (line.startsWith('+')) current.lines.push({ kind: 'add', text: line.slice(1), newLine: newLine++ });
    else if (line.startsWith('-')) current.lines.push({ kind: 'remove', text: line.slice(1), oldLine: oldLine++ });
    else if (!line.startsWith('\\')) current.lines.push({ kind: 'same', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
  }
  finish();
  return hunks;
}

const TONE: Record<DiffLine['kind'], string> = { add: 'bg-green-500/15', remove: 'bg-red-500/15', same: '' };
const MARK: Record<DiffLine['kind'], string> = { add: '+', remove: '−', same: '' };

function LineNumber({ n }: { n?: number }) {
  return <span class="w-12 shrink-0 pr-2 text-right text-muted select-none">{n ?? ''}</span>;
}

function UnifiedRows({ lines }: { lines: DiffLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} class={`flex min-w-max ${TONE[l.kind]}`}>
          <LineNumber n={l.oldLine} />
          <LineNumber n={l.newLine} />
          <span class="w-4 shrink-0 text-muted select-none">{MARK[l.kind]}</span>
          <span class="whitespace-pre pr-4">{l.text}</span>
        </div>
      ))}
    </>
  );
}

/** Old on the left, new on the right; removed and added lines in the same run are paired up. */
function SplitRows({ lines }: { lines: DiffLine[] }) {
  const rows: [DiffLine | null, DiffLine | null][] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === 'same') {
      rows.push([lines[i], lines[i]]);
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'remove') removed.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') added.push(lines[i++]);
    for (let j = 0; j < Math.max(removed.length, added.length); j++) rows.push([removed[j] ?? null, added[j] ?? null]);
  }
  const column = (pick: (row: [DiffLine | null, DiffLine | null]) => [DiffLine | null, number | undefined]) => (
    <div class="flex-1 min-w-0 overflow-x-auto">
      <div class="min-w-max">
        {rows.map((row, i) => {
          const [l, n] = pick(row);
          return (
            <div key={i} class={`flex ${l ? TONE[l.kind] : 'bg-panel/50'}`}>
              <LineNumber n={n} />
              <span class="whitespace-pre pr-2">{l?.text || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div class="flex">
      {column(([left]) => [left, left?.oldLine])}
      <div class="w-px shrink-0 bg-divider" />
      {column(([, right]) => [right, right?.newLine])}
    </div>
  );
}

/** A diff's hunks, each with an optional action (Stage / Unstage). */
function Hunks({ diff, action }: { diff: string; action?: { label: string; run: (patch: string) => void } }) {
  const hunks = parse(diff);
  if (hunks.length === 0) return <p class="m-0 px-3 py-2 text-muted font-sans">No changes.</p>;
  return (
    <>
      {hunks.map((h, i) => (
        <div key={i}>
          <div class="flex items-center gap-2 h-6 px-3 bg-panel text-muted font-sans">
            <span class="flex-1 truncate font-mono">{h.title || '⋯'}</span>
            {action && <button type="button" class="hover:text-strong" data-testid="diff-hunk-action" onClick={() => action.run(h.patch)}>{action.label}</button>}
          </div>
          {layout.value === 'split' ? <SplitRows lines={h.lines} /> : <UnifiedRows lines={h.lines} />}
        </div>
      ))}
    </>
  );
}

/** A file's uncommitted changes in two parts, unstaged and staged, each hunk with Stage or Unstage. */
function WorkingDiffView({ path }: { path: string }) {
  const [diff, setDiff] = useState<WorkingDiff | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const load = () => void window.saturn.git.workingDiff(path).then(setDiff, (e) => setProblem(errorText(e)));
    load();
    const offGit = window.saturn.git.onChanged(load);
    const offFs = window.saturn.fs.onChanged(load);
    return () => {
      offGit();
      offFs();
    };
  }, [path]);
  if (!diff) return problem ? <p class="m-0 p-3 text-accent">{problem}</p> : null;
  const apply = (patch: string, unstage: boolean) => {
    setProblem(null);
    void window.saturn.git.applyHunk(patch, unstage).catch((e) => setProblem(errorText(e)));
  };
  return (
    <>
      {problem && <p class="m-0 px-3 py-2 text-accent font-sans" role="alert">{problem}</p>}
      <div class="px-3 pt-2 pb-1 font-semibold text-strong font-sans">Unstaged changes</div>
      <Hunks diff={diff.unstaged} action={diff.untracked ? undefined : { label: 'Stage', run: (p) => apply(p, false) }} />
      {diff.untracked && <p class="m-0 px-3 py-1 text-muted font-sans">A new file is staged as a whole: tick it in the Commit panel.</p>}
      {!diff.untracked && (
        <>
          <div class="px-3 pt-3 pb-1 font-semibold text-strong font-sans">Staged changes</div>
          <Hunks diff={diff.staged} action={{ label: 'Unstage', run: (p) => apply(p, true) }} />
        </>
      )}
    </>
  );
}

/**
 * A read-only diff tab: a commit's change to a file (`diff`), or a file's uncommitted changes
 * (`workingPath`, project-relative), which stay current and can be staged one hunk at a time.
 */
export function DiffView({ diff, workingPath }: { diff?: string; workingPath?: string }) {
  return (
    <div class="h-full flex flex-col bg-editor" data-testid="diff-view">
      <div class="flex-1 overflow-auto font-mono text-[12px] leading-[1.6] select-text">
        {workingPath ? <WorkingDiffView path={workingPath} /> : <Hunks diff={diff ?? ''} />}
      </div>
    </div>
  );
}
