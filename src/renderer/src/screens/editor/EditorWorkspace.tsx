import { signal } from '@preact/signals';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { SaturnApi } from '@shared/api';
import { FileIcon, FolderIcon, TerminalIcon } from '@renderer/components';
import { FileTemplateRegistry, templateFileName } from '@renderer/files/FileTemplateRegistry';
import { CommandRegistry } from '@renderer/commands/CommandRegistry';
import { EditorDocuments } from '@renderer/editor/EditorDocuments';
import { DockLayoutModel } from '@renderer/panels/DockLayoutModel';
import { PanelRegistry } from '@renderer/panels/PanelRegistry';
import { PreviewRegistry } from '@renderer/preview/PreviewRegistry';
import { ModuleBridge } from '@renderer/modules/ModuleBridge';
import { ProjectPanel } from '@renderer/panels/builtin/ProjectPanel';
import { TerminalPanel } from '@renderer/panels/builtin/TerminalPanel';
import { TerminalController } from '@renderer/terminal/TerminalController';

const SAVE_DELAY_MS = 300;
const isMac = navigator.userAgent.includes('Mac');
export const MOD = isMac ? '⌘' : 'Ctrl+';

/** Everything one editor window owns: panels, layout, open files, terminals and commands. */
export class EditorWorkspace {
  readonly panels = new PanelRegistry();
  readonly commands = new CommandRegistry();
  readonly fileTemplates = new FileTemplateRegistry();
  readonly previews = new PreviewRegistry();
  readonly documents: EditorDocuments;
  readonly terminals: TerminalController;
  /** "<line>:<column>" of the active editor's cursor, shown in the status bar. */
  readonly cursor = signal('1:1');
  /** A message for the status bar, e.g. when the extension host stops. */
  readonly notice = signal<string | null>(null);
  readonly modules = new ModuleBridge(this);
  layout!: DockLayoutModel;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly api: SaturnApi, readonly projectPath: string) {
    this.documents = new EditorDocuments(api);
    this.terminals = new TerminalController(api, projectPath);
    this.registerBuiltInPanels();
    this.registerBuiltInCommands();
    const core = { source: 'core', icon: <FileIcon /> } as const;
    this.fileTemplates.register({ ...core, id: 'core.text', label: 'Text file', kind: 'file', extension: '.txt', placeholder: 'File name' });
    this.fileTemplates.register({ ...core, id: 'core.markdown', label: 'Markdown', kind: 'file', extension: '.md', placeholder: 'File name' });
    this.fileTemplates.register({ ...core, id: 'core.folder', label: 'Folder', kind: 'dir', icon: <FolderIcon />, placeholder: 'Folder name' });
  }

  /** Creates a file or folder from a template, then opens it if it's a file. Returns the new path. */
  async createFromTemplate(templateId: string, dir: string, name: string): Promise<string> {
    const template = this.fileTemplates.get(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    const trimmed = name.trim();
    if (!trimmed || /[\\/:*?"<>|]/.test(trimmed)) throw new Error('Name can\'t be empty or contain / \\ : * ? " < > |');
    const ctx = { name: trimmed, dir, projectPath: this.projectPath };
    const built = await template.build?.(ctx);
    const separator = dir.includes('\\') ? '\\' : '/';
    const path = `${dir}${separator}${built?.fileName ?? templateFileName(template, ctx)}`;
    if (template.kind === 'dir') {
      await this.api.fs.createDir(path);
    } else {
      await this.api.fs.createFile(path, built?.content ?? (await template.content?.(ctx)) ?? '');
      await this.documents.open(path);
    }
    return path;
  }

  get projectName(): string {
    return this.projectPath.split(/[\\/]/).pop() ?? this.projectPath;
  }

  async load(): Promise<void> {
    // Modules first, so their panels are known before the saved layout is applied.
    await this.modules.start();
    this.layout = new DockLayoutModel(this.panels, await this.api.layout.load());
    this.layout.clampTo({ width: window.innerWidth, height: window.innerHeight });
    this.layout.state.subscribe(() => this.scheduleSave());
    this.panels.changed.subscribe(() => this.layout.sync());
    window.addEventListener('resize', () => this.layout.clampTo({ width: window.innerWidth, height: window.innerHeight }));
    this.api.window.onSaveAll(async () => {
      await this.documents.saveAll();
      this.api.window.close();
    });
  }

  /** Shows the terminal panel wherever it's docked. */
  showTerminal(): void {
    this.layout.show('terminal');
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.api.layout.save(this.layout.toJSON()), SAVE_DELAY_MS);
  }

  private registerBuiltInPanels(): void {
    this.panels.register({
      id: 'project',
      title: 'Project',
      icon: <FolderIcon />,
      defaultDock: 'left',
      source: 'core',
      render: () => <ProjectPanel />,
    });
    this.panels.register({
      id: 'terminal',
      title: 'Terminal',
      icon: <TerminalIcon />,
      defaultDock: 'bottom',
      source: 'core',
      render: () => <TerminalPanel controller={this.terminals} />,
    });
  }

  private registerBuiltInCommands(): void {
    const source = { id: 'core', label: 'Saturn' } as const;
    const add = (id: string, title: string, run: () => void | Promise<void>, shortcut?: string) =>
      this.commands.register({ id: `core.${id}`, title, source, run, shortcut });

    add('openSettings', 'Open Settings', () => this.api.windows.openSettings());
    add('openMarketplace', 'Open Marketplace', () => this.api.windows.openMarketplace());
    add('toggleTerminal', 'Toggle Terminal', () => this.layout.toggle('terminal'));
    add('toggleProject', 'Toggle Project', () => this.layout.toggle('project'));
    add('saveFile', 'Save File', () => this.documents.save(), `${MOD}S`);
    add('newTerminal', 'New Terminal', async () => {
      await this.terminals.openTerminal();
      this.showTerminal();
    });
    add('closeTab', 'Close Tab', () => {
      const path = this.documents.activePath.value;
      if (path) this.documents.close(path);
    });
  }
}

export const WorkspaceContext = createContext<EditorWorkspace | null>(null);

export function useWorkspace(): EditorWorkspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace must be used inside an editor window');
  return ws;
}
