import { useEffect, useState } from 'preact/hooks';
import { Dock } from '@renderer/panels/Dock';
import { IconStrip } from '@renderer/panels/IconStrip';
import { EditorArea } from './EditorArea';
import { EditorWorkspace, WorkspaceContext } from './EditorWorkspace';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

export function EditorScreen() {
  const [ws, setWs] = useState<EditorWorkspace | null>(null);

  useEffect(() => {
    const workspace = new EditorWorkspace(window.saturn, window.saturn.window.projectPath!);
    void workspace.load().then(() => setWs(workspace));
  }, []);

  if (!ws) return null;
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
        </div>
        <StatusBar />
      </div>
    </WorkspaceContext.Provider>
  );
}
