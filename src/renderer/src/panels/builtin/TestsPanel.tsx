import { useEffect, useState } from 'preact/hooks';
import type { TestItem, TestResult, TestSet } from '@shared/modules';
import { Button, CloseIcon, DebugIcon, IconButton, PlayIcon, RefreshIcon, Select, StopIcon, TextInput, TreeRow } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { errorText } from '@renderer/helpers';
import { isMac } from '@renderer/commands/keymap';
import { leaves } from './TestsController';

const MARK: Record<TestResult['state'], { text: string; class: string }> = {
  running: { text: '…', class: 'text-muted' },
  passed: { text: '✓', class: 'text-green-500' },
  failed: { text: '✕', class: 'text-error' },
  skipped: { text: '–', class: 'text-muted' },
};

const keyOf = (controllerId: string, id: string) => `${controllerId}\u0000${id}`;

function summary(states: (TestResult['state'] | undefined)[]): TestResult['state'] | undefined {
  if (states.includes('running')) return 'running';
  if (states.includes('failed')) return 'failed';
  if (states.length && states.every((s) => s === 'passed' || s === 'skipped')) return states.every((s) => s === 'skipped') ? 'skipped' : 'passed';
  return undefined;
}

export function TestsPanel() {
  const ws = useWorkspace();
  const tests = ws.tests;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<{ controllerId: string; id: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sets, setSets] = useState<TestSet[]>([]);
  const [activeSet, setActiveSet] = useState<string>('');
  const [naming, setNaming] = useState<string | null>(null);
  const groups = tests.groups.value;
  tests.results.value;

  useEffect(() => {
    void tests.discover().catch((e) => setProblem(errorText(e)));
    void window.saturn.tests.sets().then(setSets);
  }, []);

  const run = (task: Promise<unknown>) => {
    setProblem(null);
    void task.catch((e) => setProblem(errorText(e)));
  };

  const set = sets.find((s) => s.name === activeSet);
  const inSet = (controllerId: string, item: TestItem): boolean =>
    !set || leaves([item]).some((l) => set.tests.some((t) => t.controllerId === controllerId && t.id === l.id));
  const q = filter.trim().toLowerCase();
  const matches = (controllerId: string, item: TestItem): boolean =>
    inSet(controllerId, item) && (!q || item.label.toLowerCase().includes(q) || (item.children ?? []).some((c) => matches(controllerId, c)));

  const pick = (controllerId: string, item: TestItem, e: MouseEvent) => {
    const key = keyOf(controllerId, item.id);
    const toggle = isMac ? e.metaKey : e.ctrlKey;
    setSelected((prev) => {
      if (!toggle) return new Set([key]);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setFocused({ controllerId, id: item.id });
    if (!toggle && item.path) void ws.documents.open(item.path, { line: item.line });
  };

  const rows: preact.JSX.Element[] = [];
  const walk = (controllerId: string, canDebug: boolean, items: TestItem[], depth: number) => {
    for (const item of items.filter((i) => matches(controllerId, i))) {
      const key = keyOf(controllerId, item.id);
      const parent = !!item.children?.length;
      const ids = parent ? leaves(item.children!).map((l) => l.id) : [item.id];
      const state = parent ? summary(leaves(item.children!).map((l) => tests.result(controllerId, l.id)?.state)) : tests.result(controllerId, item.id)?.state;
      const open = expanded.has(key) || !!q || !!set;
      const duration = tests.result(controllerId, item.id)?.durationMs;
      rows.push(
        <div key={key} class="group relative" onClick={(e) => pick(controllerId, item, e)}>
          <TreeRow
            depth={depth}
            label={item.label}
            icon={<span class={`w-3 text-center ${state ? MARK[state].class : 'text-muted'}`}>{state ? MARK[state].text : '○'}</span>}
            description={duration !== undefined ? `${duration} ms` : undefined}
            expanded={parent ? open : undefined}
            selected={selected.has(key)}
            onToggle={parent ? () => setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            }) : undefined}
            onClick={() => undefined}
          />
          <span class="absolute right-1 top-0.5 hidden group-hover:flex gap-0.5" onClick={(e) => e.stopPropagation()}>
            {canDebug && <IconButton class="size-5" icon={<DebugIcon class="size-3" />} label={`Debug ${item.label}`} data-testid="test-debug-item" onClick={() => run(tests.debug(controllerId, ids))} />}
            <IconButton class="size-5" icon={<PlayIcon class="size-3" />} label={`Run ${item.label}`} data-testid="test-run-item" onClick={() => run(tests.run(controllerId, ids))} />
          </span>
        </div>,
      );
      if (parent && open) walk(controllerId, canDebug, item.children!, depth + 1);
    }
  };
  for (const g of groups) {
    if (groups.length > 1) rows.push(<div key={`g:${g.controllerId}`} class="px-2 h-6 flex items-center text-muted font-semibold">{g.label}</div>);
    if (g.error) rows.push(<p key={`e:${g.controllerId}`} class="m-0 px-3 text-error">{g.error}</p>);
    walk(g.controllerId, !!g.canDebug, g.items, 0);
  }

  const selectedLeaves = () => groups.flatMap((g) => {
    const chosen = g.items.length ? [...selected].filter((k) => k.startsWith(`${g.controllerId}\u0000`)).map((k) => k.slice(g.controllerId.length + 1)) : [];
    const find = (items: TestItem[]): TestItem[] => items.flatMap((i) => (chosen.includes(i.id) ? leaves([i]) : find(i.children ?? [])));
    return find(g.items).map((l) => ({ controllerId: g.controllerId, id: l.id }));
  });

  const runSet = () => {
    if (!set) return;
    tests.output.value = '';
    run(Promise.all(groups.map((g) => {
      const ids = set.tests.filter((t) => t.controllerId === g.controllerId).map((t) => t.id);
      return ids.length ? tests.run(g.controllerId, ids) : Promise.resolve();
    })));
  };

  const saveSet = (name: string) => run(window.saturn.tests.saveSet({ name, tests: selectedLeaves() }).then((next) => {
    setSets(next);
    setActiveSet(name.trim());
    setNaming(null);
  }));

  const all = groups.flatMap((g) => leaves(g.items).map((i) => tests.result(g.controllerId, i.id)?.state));
  const failedCount = all.filter((s) => s === 'failed').length;
  const passedCount = all.filter((s) => s === 'passed').length;
  const message = focused ? tests.result(focused.controllerId, focused.id)?.message : undefined;
  const coverage = tests.coverageSummary();

  return (
    <div class="h-full flex flex-col min-h-0" data-testid="tests-panel">
      <div class="flex items-center gap-1 h-8 px-2 border-b border-divider shrink-0">
        {tests.running.value
          ? <IconButton icon={<StopIcon />} label="Stop running tests" data-testid="tests-stop" onClick={() => run(tests.stop())} />
          : <IconButton icon={<PlayIcon />} label={set ? `Run the ${set.name} set` : 'Run all tests'} data-testid="tests-run-all" disabled={!groups.length} onClick={() => (set ? runSet() : run(tests.runAll()))} />}
        <IconButton icon={<span class="text-error font-semibold">✕</span>} label="Run failed tests" data-testid="tests-run-failed" disabled={!failedCount || tests.running.value} onClick={() => run(tests.runFailed())} />
        {groups.some((g) => g.canCover) && (
          <IconButton icon={<span class="font-semibold text-green-500">%</span>} label="Run all tests with coverage" data-testid="tests-run-coverage" disabled={tests.running.value} onClick={() => run(tests.runAllWithCoverage())} />
        )}
        {coverage && (
          <IconButton
            icon={<span class={tests.showCoverage.value ? 'text-strong' : 'text-muted line-through'}>▍</span>}
            label={tests.showCoverage.value ? 'Hide coverage in the editor' : 'Show coverage in the editor'}
            active={tests.showCoverage.value}
            data-testid="tests-toggle-coverage"
            onClick={() => (tests.showCoverage.value = !tests.showCoverage.value)}
          />
        )}
        <IconButton icon={<RefreshIcon />} label="Find tests again" disabled={tests.loading.value} onClick={() => run(tests.discover())} />
        <TextInput class="flex-1 h-6 ml-1" value={filter} onInput={setFilter} placeholder="Filter tests" />
        <div class="w-40" data-testid="tests-set">
          <Select value={activeSet} options={[{ value: '', label: 'All tests' }, ...sets.map((s) => ({ value: s.name, label: s.name }))]} onChange={setActiveSet} />
        </div>
        {set && <IconButton icon={<CloseIcon class="size-3.5" />} label={`Delete the ${set.name} set`} data-testid="tests-delete-set" onClick={() => run(window.saturn.tests.removeSet(set.name).then((next) => {
          setSets(next);
          setActiveSet('');
        }))} />}
        {!set && selected.size > 0 && naming === null && <Button testId="tests-save-set" onClick={() => setNaming('')}>Save as set…</Button>}
        <span class="ml-2 text-muted whitespace-nowrap" data-testid="tests-summary">
          {tests.running.value ? 'Running…' : all.some(Boolean) ? `${passedCount} passed, ${failedCount} failed` : ''}
          {!tests.running.value && coverage && coverage.total > 0 ? ` · ${Math.round((coverage.covered / coverage.total) * 100)}% of lines covered` : ''}
        </span>
      </div>
      {naming !== null && (
        <div class="flex items-center gap-2 px-2 py-1 border-b border-divider" data-testid="tests-set-name">
          <TextInput class="flex-1 h-6" value={naming} onInput={setNaming} placeholder="Test set name" testId="tests-set-name-input" autoFocus onKeyDown={(e) => {
            if (e.key === 'Enter') saveSet(naming);
            if (e.key === 'Escape') setNaming(null);
          }} />
          <Button onClick={() => setNaming(null)}>Cancel</Button>
          <Button variant="primary" disabled={!naming.trim()} onClick={() => saveSet(naming)}>Save</Button>
        </div>
      )}
      {problem && <p class="m-0 px-3 py-1 text-error">{problem}</p>}
      <div class="flex flex-1 min-h-0">
        <div class="flex-1 min-w-0 overflow-y-auto py-1" role="tree">
          {tests.loading.value && !groups.length && <p class="m-0 px-3 text-muted">Finding tests…</p>}
          {!tests.loading.value && !groups.length && <p class="m-0 px-3 text-muted">No tests found. Tests appear here when an installed language supports them.</p>}
          {rows}
        </div>
        <div class="w-2/5 min-w-0 border-l border-divider overflow-auto px-2 py-1 font-mono whitespace-pre-wrap break-words" data-testid="tests-output">
          {message ? <span class="text-error">{message}</span> : tests.output.value || <span class="text-muted font-sans">Select a failed test to see why, or run tests to see their output. {isMac ? '⌘' : 'Ctrl'}-click to select several and save them as a set.</span>}
        </div>
      </div>
    </div>
  );
}
