import { useEffect, useState } from 'preact/hooks';
import type { GitCommit, RebaseStep } from '@shared/types';
import { Button, Select } from '@renderer/components';
import { errorText } from '@renderer/helpers';

type Action = RebaseStep['action'];

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'pick', label: 'Pick' },
  { value: 'squash', label: 'Squash' },
  { value: 'fixup', label: 'Fixup' },
  { value: 'edit', label: 'Edit' },
  { value: 'drop', label: 'Drop' },
];

export function RebaseDialog({ onto, onClose }: { onto: GitCommit; onClose: () => void }) {
  const [rows, setRows] = useState<{ commit: GitCommit; action: Action }[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.saturn.git.rebaseCommits(onto.hash).then(
      (commits) => setRows(commits.map((commit) => ({ commit, action: 'pick' }))),
      (e) => setProblem(errorText(e)),
    );
  }, [onto.hash]);

  const move = (from: number, to: number) => {
    if (!rows || from === to) return;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setRows(next);
  };

  const start = async () => {
    if (!rows) return;
    setBusy(true);
    setProblem(null);
    try {
      await window.saturn.git.rebaseInteractive(onto.hash, rows.map((r) => ({ hash: r.commit.hash, action: r.action })));
      onClose();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/30" data-testid="rebase-dialog">
      <div class="w-[560px] max-w-[calc(100vw-32px)] max-h-[80vh] p-3 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-2">
        <div class="font-semibold text-strong">Interactive rebase onto {onto.short}</div>
        <p class="m-0 text-muted">Drag to reorder. Oldest first; each commit is replayed in this order.</p>
        <div class="flex-1 min-h-0 overflow-y-auto border border-divider">
          {rows === null && !problem && <p class="m-0 p-2 text-muted">Loading…</p>}
          {rows?.length === 0 && <p class="m-0 p-2 text-muted">No commits after {onto.short} on this branch.</p>}
          {rows?.map((r, i) => (
            <div
              key={r.commit.hash}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragging !== null && dragging !== i) {
                  move(dragging, i);
                  setDragging(i);
                }
              }}
              onDragEnd={() => setDragging(null)}
              class={`flex items-center gap-2 h-8 px-2 cursor-grab ${dragging === i ? 'bg-selection' : 'hover:bg-hover'} ${r.action === 'drop' ? 'opacity-50 line-through' : ''}`}
              data-testid="rebase-row"
            >
              <Select<Action>
                class="w-24 h-6"
                value={r.action}
                options={ACTIONS}
                onChange={(action) => setRows(rows.map((row, j) => (j === i ? { ...row, action } : row)))}
              />
              <span class="font-mono text-muted shrink-0">{r.commit.short}</span>
              <span class="flex-1 truncate">{r.commit.subject}</span>
            </div>
          ))}
        </div>
        {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
        <div class="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" testId="rebase-start" disabled={busy || !rows?.length} onClick={() => void start()}>Start rebase</Button>
        </div>
      </div>
    </div>
  );
}
