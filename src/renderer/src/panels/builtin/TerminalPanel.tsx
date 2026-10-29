import { useEffect, useRef } from 'preact/hooks';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { IconButton, PlusIcon, TabMenu } from '@renderer/components';
import type { TerminalController } from '@renderer/panels/builtin/TerminalController';
import { tokenRgba } from '@renderer/theme/ThemeApplier';

/** Builds the xterm colour theme from the active Saturn theme's CSS variables. */
function xtermTheme(): ITheme {
  return {
    background: tokenRgba('panel'),
    foreground: tokenRgba('text'),
    cursor: tokenRgba('accent'),
    selectionBackground: tokenRgba('selection'),
  };
}

function TerminalView({ controller, id }: { controller: TerminalController; id: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--saturn-font-editor').trim() || 'JetBrains Mono, Menlo, Consolas, monospace';
    const term = new Terminal({ fontFamily, fontSize: 12, theme: xtermTheme(), cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    const detach = controller.attach(id, (data) => term.write(data));
    const input = term.onData((data) => controller.write(id, data));
    term.attachCustomKeyEventHandler((e) => {
      if (e.key !== 'Enter' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return true;
      if (e.type === 'keydown') controller.write(id, '\x1b\r');
      return false;
    });
    const refit = () => {
      fit.fit();
      controller.resize(id, term.cols, term.rows);
    };
    const observer = new ResizeObserver(refit);
    observer.observe(host.current!);
    const onTheme = () => (term.options.theme = xtermTheme());
    window.addEventListener('saturn:theme', onTheme);
    term.focus();
    return () => {
      window.removeEventListener('saturn:theme', onTheme);
      observer.disconnect();
      input.dispose();
      detach();
      term.dispose();
    };
  }, [id]);

  return <div ref={host} class="h-full w-full pl-2 pt-1" data-testid="terminal-view" />;
}

/** Terminal panel: one tab per terminal, plus a button to open a new shell in the project folder. */
export function TerminalPanel({ controller }: { controller: TerminalController }) {
  const tabs = controller.tabs.value;
  const active = controller.activeId.value;

  useEffect(() => {
    if (controller.tabs.value.length === 0) void controller.openTerminal();
  }, []);

  return (
    <div class="flex flex-col h-full">
      <TabMenu
        tabs={tabs.map((t) => ({ id: t.id, label: t.exited ? `${t.name} (exited)` : t.name, closable: true }))}
        active={active}
        onSelect={(id) => (controller.activeId.value = id)}
        onClose={(id) => controller.close(id)}
        trailing={<IconButton icon={<PlusIcon />} label="New Terminal" onClick={() => void controller.openTerminal()} />}
      />
      <div class="flex-1 min-h-0">{active && <TerminalView key={active} controller={controller} id={active} />}</div>
    </div>
  );
}
