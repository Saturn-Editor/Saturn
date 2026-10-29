import type { ComponentChildren } from 'preact';
import { BreakpointsPanel, CallStackPanel, DebugConsolePanel, DebugPanel, VariablesPanel } from '@renderer/panels/builtin/DebugPanel';
import { DiagnosticsPanel } from '@renderer/panels/builtin/DiagnosticsPanel';
import { useWorkspace } from './EditorWorkspace';

function Pane({ title, class: cls = '', children }: { title: string; class?: string; children: ComponentChildren }) {
  return (
    <section class={`flex flex-col min-h-0 min-w-0 ${cls}`}>
      <header class="flex items-center h-7 px-2.5 shrink-0 font-semibold text-strong bg-panel border-b border-divider">{title}</header>
      <div class="flex-1 min-h-0 bg-panel">{children}</div>
    </section>
  );
}

export function DebugWindow() {
  const ws = useWorkspace();
  document.title = `Debug – ${ws.projectName} – Saturn`;
  return (
    <div class="h-full flex flex-col" data-testid="screen-debug-window">
      <div class="shrink-0 bg-panel"><DebugPanel controlsOnly /></div>
      <div class="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-px bg-divider">
        <Pane title="Call Stack"><CallStackPanel /></Pane>
        <Pane title="Variables"><VariablesPanel /></Pane>
        <Pane title="Diagnostics"><DiagnosticsPanel /></Pane>
        <Pane title="Breakpoints"><BreakpointsPanel /></Pane>
        <Pane title="Console" class="col-span-2"><DebugConsolePanel /></Pane>
      </div>
    </div>
  );
}
