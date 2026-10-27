import { useEffect, useRef, useState } from 'preact/hooks';
import type { DebugVariable } from '@shared/types';
import {
  ContinueIcon, IconButton, PauseIcon, PlayIcon, StepIntoIcon, StepOutIcon, StepOverIcon, StopIcon, TextInput, TreeRow,
} from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

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

/** Debug (bottom panel): controls, the paused call stack, its variables, and the program's console. */
export function DebugPanel() {
  const ws = useWorkspace();
  const { debug } = ws;
  const s = debug.state.value;
  const api = window.saturn.debug;
  const stopped = s.state === 'stopped';
  const status = { idle: 'Not debugging', starting: 'Starting…', running: 'Running', stopped: `Paused${s.reason ? ` (${s.reason})` : ''}` }[s.state];

  return (
    <div class="flex flex-col h-full" data-testid="debug-panel">
      <div class="flex items-center gap-1 h-8 px-2 border-b border-divider shrink-0">
        {s.state === 'idle' ? (
          <IconButton icon={<PlayIcon />} label="Start Debugging" data-testid="debug-start" onClick={() => void ws.commands.run('core.startDebugging')} />
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
      <div class="flex flex-1 min-h-0">
        <div class="w-56 shrink-0 overflow-y-auto border-r border-divider py-1" data-testid="debug-frames">
          {!stopped && <p class="m-0 px-3 text-muted">{s.state === 'idle' ? 'Click a line number to add a breakpoint, then start debugging.' : 'The call stack shows when the program pauses.'}</p>}
          {s.frames.map((f) => (
            <TreeRow
              key={f.id}
              depth={0}
              label={f.name}
              description={f.path ? `${f.path.split(/[\\/]/).pop()}:${f.line}` : undefined}
              selected={f.id === s.frameId}
              onClick={() => void api.selectFrame(f.id)}
            />
          ))}
        </div>
        <div class="w-72 shrink-0 overflow-y-auto border-r border-divider py-1" data-testid="debug-variables">
          {s.scopes.map((scope) => (
            <div key={scope.name}>
              <div class="px-2 h-6 flex items-center text-muted font-semibold">{scope.name}</div>
              {scope.variables.map((v, i) => <VariableRow key={`${v.name}:${i}`} variable={v} depth={0} />)}
            </div>
          ))}
        </div>
        <div class="flex-1 min-w-0"><DebugConsole /></div>
      </div>
    </div>
  );
}
