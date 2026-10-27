import { useEffect, useState } from 'preact/hooks';
import type { DocumentSymbol } from '@shared/modules';
import { Badge, TreeRow } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

const REFRESH_DELAY_MS = 400;

/** LSP SymbolKind numbers: the short badge and the name shown on hover. */
const KINDS: Record<number, [string, string]> = {
  1: ['F', 'File'], 2: ['M', 'Module'], 3: ['N', 'Namespace'], 4: ['P', 'Package'], 5: ['C', 'Class'], 6: ['m', 'Method'],
  7: ['p', 'Property'], 8: ['f', 'Field'], 9: ['c', 'Constructor'], 10: ['E', 'Enum'], 11: ['I', 'Interface'], 12: ['fn', 'Function'],
  13: ['v', 'Variable'], 14: ['K', 'Constant'], 15: ['s', 'String'], 16: ['#', 'Number'], 17: ['b', 'Boolean'], 18: ['[]', 'Array'],
  19: ['{}', 'Object'], 20: ['k', 'Key'], 21: ['∅', 'Null'], 22: ['e', 'Enum member'], 23: ['S', 'Struct'], 24: ['ev', 'Event'],
  25: ['op', 'Operator'], 26: ['T', 'Type parameter'],
};

/** Outline (left panel): what the open file defines, nested; clicking an item jumps to it. */
export function OutlinePanel() {
  const ws = useWorkspace();
  const doc = ws.documents.active.value;
  const language = doc ? ws.modules.languageFor(doc.path) : undefined;
  const supported = !!language?.features.includes('symbols');
  const [symbols, setSymbols] = useState<DocumentSymbol[]>([]);
  // Items the user collapsed (by position, so they stay collapsed while the file changes around them).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!doc || !language || !supported) return setSymbols([]);
    const timer = setTimeout(() => {
      void window.saturn.languages.symbols({ path: doc.path, languageId: language.id, text: doc.text }).then(setSymbols, () => setSymbols([]));
    }, REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [doc?.path, doc?.text, supported]);

  if (!doc) return <p class="px-3 text-muted">Open a file to see its outline.</p>;
  if (!supported) return <p class="px-3 text-muted">No outline for this file's language.</p>;
  if (symbols.length === 0) return <p class="px-3 text-muted">Nothing defined in this file.</p>;

  const rows = (list: DocumentSymbol[], depth: number, parent: string): preact.JSX.Element[] => list.flatMap((s) => {
    const key = `${parent}/${s.name}:${s.kind}`;
    const open = !collapsed.has(key);
    const [badge, kind] = KINDS[s.kind] ?? ['?', 'Symbol'];
    return [
      <TreeRow
        key={key}
        depth={depth}
        label={s.name}
        description={s.detail}
        tooltip={`${kind} ${s.name}${s.detail ? ` ${s.detail}` : ''}`}
        icon={<Badge text={badge} />}
        expanded={s.children.length ? open : undefined}
        onToggle={() => {
          const next = new Set(collapsed);
          if (open) next.add(key);
          else next.delete(key);
          setCollapsed(next);
        }}
        onClick={() => void ws.documents.open(doc.path, { line: s.range.line + 1, column: s.range.character + 1 })}
      />,
      ...(open ? rows(s.children, depth + 1, key) : []),
    ];
  });

  return <div class="h-full overflow-y-auto py-1" role="tree" data-testid="outline-panel">{rows(symbols, 0, '')}</div>;
}
