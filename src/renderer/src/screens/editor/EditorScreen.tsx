import { useEffect, useState } from 'preact/hooks';
import { actionForKey } from '@renderer/commands/keymap';
import { Dock } from '@renderer/panels/Dock';
import { ButtonStrip } from '@renderer/panels/ButtonStrip';
import { IconStrip } from '@renderer/panels/IconStrip';
import { EditorArea } from './EditorArea';
import { EditorWorkspace, WorkspaceContext } from './EditorWorkspace';
import { BranchSwitchPrompt } from './BranchSwitchPrompt';
import { StatusBar } from './StatusBar';
import { UndoToast } from './UndoToast';
import { TopBar } from './TopBar';
import { DebugWindow } from './DebugWindow';

export function EditorScreen() {
  const [ws, setWs] = useState<EditorWorkspace | null>(null);

  useEffect(() => {
    const workspace = new EditorWorkspace(window.saturn, window.saturn.window.projectPath!);
    if (workspace.isDebugWindow) {
      workspace.loadDebugWindow();
      setWs(workspace);
    } else void workspace.load().then(() => setWs(workspace));
  }, []);

  // Window-wide shortcuts from the chosen keymap (Save, Close Tab, Toggle Terminal…). Listening in the
  // capture phase means they still work while the terminal has focus, which swallows key presses.
  useEffect(() => {
    if (!ws) return;
    const onKey = (e: KeyboardEvent) => {
      const id = actionForKey(e, 'app');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      void ws.commands.run(id).catch(() => undefined);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ws]);

  if (!ws) return null;
  if (ws.isDebugWindow) return <WorkspaceContext.Provider value={ws}><DebugWindow /></WorkspaceContext.Provider>;
  ws.layout.state.value; // re-render on layout changes
  document.title = `${ws.projectName} – Saturn`;

  return (
    <WorkspaceContext.Provider value={ws}>
      <div class="flex flex-col h-full" data-testid="screen-editor">
        <TopBar />
        <div class="flex flex-1 min-h-0">
          <IconStrip />
          <Dock dock="left" />
          <div class="flex-1 flex flex-col min-w-0">
            <EditorArea />
            <Dock dock="bottom" />
          </div>
          <ButtonStrip />
        </div>
        <StatusBar />
        <BranchSwitchPrompt />
        <UndoToast />
      </div>
    </WorkspaceContext.Provider>
  );
}
