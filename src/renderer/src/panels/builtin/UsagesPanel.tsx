import { useState } from 'preact/hooks';
import type { ReferenceLocation } from '@shared/modules';
import { ChevronDownIcon, ChevronRightIcon } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

/** Usages (bottom panel): the last Find Usages results, grouped by file; clicking one opens it there. */
export function UsagesPanel() {
  const ws = useWorkspace();
  const result = ws.references.value;
  const [closed, setClosed] = useState<Set<string>>(new Set());

  if (!result) return <p class="px-3 text-muted">Use Find Usages on a symbol to list where it's used.</p>;
  const byFile = new Map<string, ReferenceLocation[]>();
  for (const r of result.list) byFile.set(r.path, [...(byFile.get(r.path) ?? []), r]);
  const relative = (path: string) => (path.startsWith(ws.projectPath) ? path.slice(ws.projectPath.length + 1) : path);

  return (
    <div class="h-full overflow-y-auto py-1" data-testid="usages-panel">
      <p class="m-0 px-3 pb-1 text-muted">
        {result.list.length} usage{result.list.length === 1 ? '' : 's'} of <span class="text-strong font-mono">{result.symbol}</span> in {byFile.size} file{byFile.size === 1 ? '' : 's'}
      </p>
      {[...byFile].map(([path, list]) => {
        const open = !closed.has(path);
        return (
          <div key={path}>
            <button
              type="button"
              class="w-full flex items-center gap-1.5 h-6 px-2 text-left hover:bg-hover"
              onClick={() => {
                const next = new Set(closed);
                if (open) next.add(path);
                else next.delete(path);
                setClosed(next);
              }}
            >
              {open ? <ChevronDownIcon class="size-3.5 text-muted" /> : <ChevronRightIcon class="size-3.5 text-muted" />}
              <span class="text-strong truncate">{path.split(/[\\/]/).pop()}</span>
              <span class="text-muted truncate flex-1">{relative(path)}</span>
              <span class="text-muted">{list.length}</span>
            </button>
            {open && list.map((r, i) => (
              <button
                type="button"
                key={i}
                class="w-full flex items-center gap-2 h-6 pl-8 pr-2 text-left hover:bg-hover"
                data-testid="usage-row"
                onClick={() => void ws.documents.open(path, { line: r.range.line + 1, column: r.range.character + 1 })}
              >
                <span class="shrink-0 text-muted w-10 text-right">{r.range.line + 1}</span>
                <span class="flex-1 truncate font-mono">{r.preview}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
