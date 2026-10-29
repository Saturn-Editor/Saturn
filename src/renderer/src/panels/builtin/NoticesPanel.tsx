import { useEffect, useState } from 'preact/hooks';
import type { Diagnostic } from '@shared/modules';
import { ChevronDownIcon, ChevronRightIcon } from '@renderer/components';
import { allDiagnostics, onDiagnosticCounts } from '@renderer/modules/languageServer';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

/** Errors and warnings in this project's files, kept current. */
export function useProjectDiagnostics(): { byFile: [string, Diagnostic[]][]; errors: number; warnings: number } {
  const ws = useWorkspace();
  const [, setVersion] = useState(0);
  useEffect(() => onDiagnosticCounts(() => setVersion((n) => n + 1)), []);
  const byFile = [...allDiagnostics()].filter(([path]) => path.startsWith(ws.projectPath)).sort(([a], [b]) => a.localeCompare(b));
  const all = byFile.flatMap(([, list]) => list);
  return { byFile, errors: all.filter((d) => d.severity === 'error').length, warnings: all.filter((d) => d.severity === 'warning').length };
}

/** Notices (bottom panel): errors and warnings grouped by file. The open file starts expanded, others collapsed. */
export function NoticesPanel() {
  const ws = useWorkspace();
  const { byFile } = useProjectDiagnostics();
  const active = ws.documents.activePath.value;
  // Files the user expanded or collapsed by hand; the rest follow "only the open file is expanded".
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const isOpen = (path: string) => toggled.get(path) ?? path === active;

  if (byFile.length === 0) return <p class="px-3 text-muted">No errors or warnings.</p>;
  return (
    <div class="h-full overflow-y-auto py-1" data-testid="notices-panel">
      {byFile.map(([path, list]) => {
        const open = isOpen(path);
        const relative = path.slice(ws.projectPath.length + 1);
        return (
          <div key={path}>
            <button
              type="button"
              class="w-full flex items-center gap-1.5 h-6 px-2 text-left hover:bg-hover"
              onClick={() => setToggled(new Map(toggled).set(path, !open))}
              data-testid="notices-file"
            >
              {open ? <ChevronDownIcon class="size-3.5 text-muted" /> : <ChevronRightIcon class="size-3.5 text-muted" />}
              <span class="text-strong truncate">{relative.split('/').pop()}</span>
              <span class="text-muted truncate flex-1">{relative}</span>
              <span class="text-muted">{list.length}</span>
            </button>
            {open && list.map((d, i) => (
              <button
                type="button"
                key={i}
                class="w-full flex items-center gap-2 h-6 pl-8 pr-2 text-left hover:bg-hover"
                title={d.message}
                onClick={() => void ws.documents.open(path, { line: d.line + 1, column: d.character + 1 })}
              >
                <span class={`shrink-0 font-semibold ${d.severity === 'error' ? 'text-error' : 'text-warning'}`}>{d.severity === 'error' ? 'Error' : 'Warning'}</span>
                <span class="flex-1 truncate">{d.message}</span>
                <span class="shrink-0 text-muted">{d.line + 1}:{d.character + 1}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
