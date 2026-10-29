import { useEffect, useState } from 'preact/hooks';
import { Button, CloseIcon, IconButton } from '@renderer/components';
import { useWorkspace } from './EditorWorkspace';
import { errorText } from '@renderer/helpers';

/** Matches how long the main process holds a deleted item before it goes to the Trash. */
const UNDO_MS = 30_000;

/** "Deleted foo.ts — Undo" at the bottom right after deleting from the Project panel, for as long as Undo works. */
export function UndoToast() {
  const ws = useWorkspace();
  const undo = ws.undo.value;
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setProblem(null);
    if (!undo) return;
    const timer = setTimeout(() => ws.undo.value === undo && (ws.undo.value = null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo?.at]);
  if (!undo) return null;

  return (
    <div class="fixed z-40 bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-2 bg-raised border border-border shadow-lg shadow-black/40" role="status" data-testid="undo-toast">
      <span class={problem ? 'text-accent' : 'text-strong'}>{problem ?? undo.text}</span>
      {!problem && (
        <Button testId="undo-button" onClick={() => void undo.run().then(() => (ws.undo.value = null), (e) => setProblem(errorText(e)))}>
          Undo
        </Button>
      )}
      <IconButton icon={<CloseIcon class="size-3" />} label="Hide" class="size-5" onClick={() => (ws.undo.value = null)} />
    </div>
  );
}
