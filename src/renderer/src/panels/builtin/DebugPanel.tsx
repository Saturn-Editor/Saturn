import { useEffect, useRef, useState } from 'preact/hooks';
import type { Breakpoint, DebugVariable } from '@shared/types';
import {
  Button, Checkbox, CloseIcon, TabMenu, ContinueIcon, IconButton, PauseIcon, PlayIcon, Select, StepIntoIcon, StepOutIcon, StepOverIcon, StopIcon, TextInput, TreeRow,
} from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { errorText, baseName } from '@renderer/helpers';
import { DiagnosticsPanel } from './DiagnosticsPanel';

/** A variable; expanding one with children fetches them. */
function VariableRow({ variable, depth }: { variable: DebugVariable; depth: number }) {
  const [children, setChildren] = useState<DebugVariable[] | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (!open && !children) void window.saturn.debug.variables(variable.ref).then(setChildren, () => setChildren([]));
    setOpen(!open);
  };
  return (
    <>
      <TreeRow
        depth={depth}
        label={variable.name}
        description={`= ${variable.value}`}
        tooltip={variable.type ? `${variable.type} ${variable.name} = ${variable.value}` : `${variable.name} = ${variable.value}`}
        expanded={variable.ref ? open : undefined}
        onClick={variable.ref ? toggle : () => undefined}
      />
      {open && children?.map((c, i) => <VariableRow key={`${c.name}:${i}`} variable={c} depth={depth + 1} />)}
    </>
  );
}

/** Program output, plus a box that evaluates expressions in the paused frame. */
function DebugConsole() {
  const { debug } = useWorkspace();
  const [expression, setExpression] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const output = debug.output.value;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [output.length]);

  const evaluate = async () => {
    const text = expression.trim();
    if (!text) return;
    setExpression('');
    debug.log(`> ${text}\n`, 'input');
    try {
      debug.log(`${await window.saturn.debug.evaluate(text)}\n`, 'result');
    } catch (e) {
      debug.log(`${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}\n`, 'stderr');
    }
  };

  return (
    <div class="flex flex-col h-full min-w-0">
      <div class="flex-1 overflow-y-auto px-2 py-1 font-mono whitespace-pre-wrap break-all" data-testid="debug-console">
        {output.map((o, i) => (
          <span key={i} class={o.category === 'stderr' ? 'text-accent' : o.category === 'input' || o.category === 'console' ? 'text-muted' : 'text-text'}>{o.text}</span>
        ))}
        <div ref={end} />
      </div>
      {debug.state.value.state === 'stopped' && (
        <div class="p-1 border-t border-divider" onKeyDown={(e) => e.key === 'Enter' && void evaluate()}>
          <TextInput class="font-mono" value={expression} onInput={setExpression} placeholder="Evaluate an expression" testId="debug-evaluate" />
        </div>
      )}
    </div>
  );
}

export function VariablesPanel() {
  const { debug } = useWorkspace();
  const s = debug.state.value;
  return (
    <div class="h-full overflow-y-auto py-1" data-testid="debug-variables">
      <Watches />
      {s.state !== 'stopped' && <p class="m-0 px-3 text-muted">Variables show when the program pauses.</p>}
      {s.scopes.map((scope) => (
        <div key={scope.name}>
          <div class="px-2 h-6 flex items-center text-muted font-semibold">{scope.name}</div>
          {scope.variables.map((v, i) => <VariableRow key={`${v.name}:${i}`} variable={v} depth={0} />)}
        </div>
      ))}
    </div>
  );
}

export function DebugConsolePanel() {
  return <DebugConsole />;
}

export function BreakpointsPanel() {
  const ws = useWorkspace();
  const { debug } = ws;
  const all = Object.entries(debug.breakpoints.value).sort(([a], [b]) => a.localeCompare(b));
  const filters = debug.state.value.exceptionFilters ?? [];
  const update = (path: string, line: number, change: Partial<Breakpoint> | null) => {
    const list = debug.breakpoints.value[path] ?? [];
    debug.setBreakpoints(path, change ? list.map((b) => (b.line === line ? { ...b, ...change } : b)) : list.filter((b) => b.line !== line));
  };
  return (
    <div class="h-full overflow-y-auto py-1" data-testid="breakpoints-panel">
      <div class="px-2 h-6 flex items-center text-muted font-semibold">Exceptions</div>
      {filters.length === 0 && <p class="m-0 px-3 pb-1 text-muted">{debug.active ? "This debugger doesn't offer exception breakpoints." : 'Exception options appear once debugging starts.'}</p>}
      {filters.map((f) => (
        <div key={f.id} class="flex items-center gap-2 h-6 px-2 hover:bg-hover" title={f.description}>
          <Checkbox
            checked={f.enabled}
            label={f.label}
            testId={`exception-${f.id}`}
            onChange={(on) => void window.saturn.debug.setExceptionFilters(filters.filter((x) => (x.id === f.id ? on : x.enabled)).map((x) => x.id))}
          />
        </div>
      ))}
      <div class="px-2 h-6 mt-1 flex items-center text-muted font-semibold">Breakpoints</div>
      {all.length === 0 && <p class="m-0 px-3 text-muted">Click a line number to add a breakpoint.</p>}
      {all.flatMap(([path, list]) => list.map((b) => (
        <div key={`${path}:${b.line}`} class="group flex items-center gap-2 h-6 px-2 hover:bg-hover" data-testid="breakpoint-row">
          <Checkbox checked={b.enabled !== false} label={b.enabled !== false ? 'Turn off' : 'Turn on'} onChange={(on) => update(path, b.line, { enabled: on })} />
          <button type="button" class="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => void ws.documents.open(path, { line: b.line })}>
            <span class={`truncate ${b.enabled === false ? 'text-muted' : 'text-strong'}`}>{baseName(path)}:{b.line}</span>
            {(b.condition || b.logMessage) && <span class="text-muted truncate font-mono">{b.logMessage ? `logs ${b.logMessage}` : `when ${b.condition}`}</span>}
          </button>
          <IconButton icon={<CloseIcon class="size-3" />} label="Remove breakpoint" class="size-5 hidden group-hover:inline-flex" onClick={() => update(path, b.line, null)} />
        </div>
      )))}
    </div>
  );
}

export type DebugTab = 'stack' | 'variables' | 'console' | 'breakpoints' | 'diagnostics';

const DEBUG_TABS: { id: DebugTab; label: string }[] = [
  { id: 'stack', label: 'Call Stack' },
  { id: 'variables', label: 'Variables' },
  { id: 'console', label: 'Console' },
  { id: 'breakpoints', label: 'Breakpoints' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export function CallStackPanel() {
  const { debug } = useWorkspace();
  const s = debug.state.value;
  const api = window.saturn.debug;
  const stopped = s.state === 'stopped';
  return (
    <div class="h-full overflow-y-auto py-1" data-testid="debug-frames">
      {!stopped && <p class="m-0 px-3 text-muted">{s.state === 'idle' ? 'Click a line number to add a breakpoint (right-click for a condition or a log message), then start debugging.' : 'The call stack shows when the program pauses.'}</p>}
      {stopped && s.threads.length > 1 && (
        <div class="px-2 pb-1" data-testid="debug-threads">
          <Select value={String(s.threadId ?? '')} options={s.threads.map((t) => ({ value: String(t.id), label: t.name || `Thread ${t.id}` }))} onChange={(id) => void api.selectThread(Number(id))} />
        </div>
      )}
      {s.frames.map((f) => (
        <TreeRow
          key={f.id}
          depth={0}
          label={f.name}
          description={f.path ? `${baseName(f.path)}:${f.line}` : undefined}
          selected={f.id === s.frameId}
          onClick={() => void api.selectFrame(f.id)}
        />
      ))}
    </div>
  );
}

export function DebugPanel({ controlsOnly = false }: { controlsOnly?: boolean }) {
  const ws = useWorkspace();
  const { debug } = ws;
  const s = debug.state.value;
  const api = window.saturn.debug;
  const stopped = s.state === 'stopped';
  const status = { idle: 'Not debugging', starting: 'Starting…', running: 'Running', stopped: `Paused${s.reason ? ` (${s.reason})` : ''}` }[s.state];
  // The open file's debugger: its extra launch configurations, and whether it can attach.
  const path = ws.documents.activePath.value;
  const language = path ? ws.modules.languageFor(path) : undefined;
  const debuggerInfo = language ? ws.modules.snapshot.value.debuggers.find((d) => d.languages.includes(language.id)) : undefined;
  const [attaching, setAttaching] = useState(false);

  return (
    <div class="relative flex flex-col h-full" data-testid="debug-panel">
      <div class="flex items-center gap-1 h-8 px-2 border-b border-divider shrink-0">
        {s.state === 'idle' ? (
          <>
            <IconButton icon={<PlayIcon />} label="Start Debugging" data-testid="debug-start" onClick={() => void ws.commands.run('core.startDebugging')} />
            {debuggerInfo && debuggerInfo.configurations.length > 0 && (
              <Select
                value={debug.configuration.value ?? ''}
                options={[{ value: '', label: 'Default' }, ...debuggerInfo.configurations.map((c) => ({ value: c.id, label: c.label }))]}
                onChange={(id) => (debug.configuration.value = id || null)}
              />
            )}
            {debuggerInfo?.canAttach && <Button testId="debug-attach" onClick={() => setAttaching(true)}>Attach…</Button>}
          </>
        ) : (
          <>
            {stopped
              ? <IconButton icon={<ContinueIcon />} label="Continue" data-testid="debug-continue" onClick={() => void api.continue()} />
              : <IconButton icon={<PauseIcon />} label="Pause" data-testid="debug-pause" onClick={() => void api.pause()} />}
            <IconButton icon={<StepOverIcon />} label="Step Over" disabled={!stopped} onClick={() => void api.next()} />
            <IconButton icon={<StepIntoIcon />} label="Step Into" disabled={!stopped} onClick={() => void api.stepIn()} />
            <IconButton icon={<StepOutIcon />} label="Step Out" disabled={!stopped} onClick={() => void api.stepOut()} />
            <IconButton icon={<StopIcon />} label="Stop Debugging" data-testid="debug-stop" onClick={() => void api.stop()} />
          </>
        )}
        <span class="ml-2 text-strong truncate">{s.name}</span>
        <span class="text-muted truncate" data-testid="debug-status">{status}</span>
      </div>
      {!controlsOnly && <TabMenu<DebugTab> tabs={DEBUG_TABS} active={debug.tab.value} onSelect={(t) => (debug.tab.value = t)} />}
      {!controlsOnly && <div class="flex-1 min-h-0">
        {debug.tab.value === 'stack' && <CallStackPanel />}
        {debug.tab.value === 'variables' && <VariablesPanel />}
        {debug.tab.value === 'console' && <DebugConsolePanel />}
        {debug.tab.value === 'breakpoints' && <BreakpointsPanel />}
        {debug.tab.value === 'diagnostics' && <DiagnosticsPanel />}
      </div>}
      {attaching && path && language && (
        <ProcessPicker
          onPick={(pid) => {
            setAttaching(false);
            ws.layout.show('debug');
            void debug.start(path, language.id, pid).catch((e: Error) => (ws.notice.value = { text: errorText(e), kind: 'error' }));
          }}
          onClose={() => setAttaching(false)}
        />
      )}
    </div>
  );
}

/** Watch expressions: added here, evaluated in the selected frame whenever the program pauses. */
function Watches() {
  const { debug } = useWorkspace();
  const [adding, setAdding] = useState('');
  const values = debug.state.value.watches;
  const list = debug.watches.value;
  const add = () => {
    const expression = adding.trim();
    if (expression && !list.includes(expression)) debug.setWatches([...list, expression]);
    setAdding('');
  };
  return (
    <div class="pb-1 mb-1 border-b border-divider" data-testid="debug-watches">
      <div class="px-2 h-6 flex items-center text-muted font-semibold">Watch</div>
      {list.map((expression) => {
        const watch = values.find((w) => w.expression === expression);
        return (
          <div key={expression} class="group flex items-center gap-1.5 h-6 px-2 hover:bg-hover" title={watch?.error ?? watch?.value}>
            <span class="text-strong font-mono truncate">{expression}</span>
            <span class={`flex-1 truncate font-mono ${watch?.error ? 'text-accent' : 'text-muted'}`}>{watch?.error ? 'not available' : watch?.value !== undefined ? `= ${watch.value}` : ''}</span>
            <IconButton icon={<CloseIcon class="size-3" />} label={`Remove ${expression}`} class="size-5 hidden group-hover:inline-flex" onClick={() => debug.setWatches(list.filter((x) => x !== expression))} />
          </div>
        );
      })}
      <div class="px-2 pt-0.5" onKeyDown={(e) => e.key === 'Enter' && add()}>
        <TextInput class="w-full h-6 font-mono" value={adding} onInput={setAdding} placeholder="Add an expression" testId="debug-watch-add" />
      </div>
    </div>
  );
}

/** Attach…: running processes, filtered as you type; picking one attaches the debugger to it. */
function ProcessPicker({ onPick, onClose }: { onPick: (pid: number) => void; onClose: () => void }) {
  const [processes, setProcesses] = useState<{ pid: number; name: string }[] | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => void window.saturn.debug.processes().then(setProcesses, () => setProcesses([])), []);
  const q = filter.trim().toLowerCase();
  const shown = (processes ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.pid).includes(q)).slice(0, 200);
  return (
    <div class="absolute inset-0 z-20 flex items-center justify-center bg-black/30" data-testid="debug-process-picker" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div class="w-96 max-h-[90%] flex flex-col bg-raised border border-border shadow-lg shadow-black/40">
        <div class="p-2 border-b border-divider flex flex-col gap-2">
          <div class="font-semibold text-strong">Attach to a process</div>
          <TextInput value={filter} onInput={setFilter} placeholder="Filter by name or id" testId="debug-process-filter" autoFocus />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto py-1">
          {processes === null && <p class="m-0 px-3 text-muted">Loading…</p>}
          {processes && shown.length === 0 && <p class="m-0 px-3 text-muted">None.</p>}
          {shown.map((p) => (
            <button key={p.pid} type="button" class="w-full flex items-center gap-2 h-6 px-3 text-left hover:bg-hover" onClick={() => onPick(p.pid)}>
              <span class="flex-1 truncate">{p.name}</span>
              <span class="text-muted font-mono">{p.pid}</span>
            </button>
          ))}
        </div>
        <div class="p-2 border-t border-divider flex justify-end"><Button onClick={onClose}>Cancel</Button></div>
      </div>
    </div>
  );
}
