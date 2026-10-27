import { signal } from '@preact/signals';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { EditorView } from '@codemirror/view';
import type { SaturnApi } from '@shared/api';
import { applyTextEdits, type FileEdits, type MessageKind, type ReferenceLocation } from '@shared/modules';
import { CollapseAllIcon, CommitIcon, DebugIcon, ExpandAllIcon, IconButton, RefreshIcon, FileIcon, FolderIcon, GitIcon, NoticesIcon, OutlineIcon, TerminalIcon, UsagesIcon } from '@renderer/components';
import { DebugController } from '@renderer/panels/builtin/DebugController';
import { DebugPanel } from '@renderer/panels/builtin/DebugPanel';
import { findReferences, formatDocument, renameSymbol } from '@renderer/modules/languageServer';
import { OutlinePanel } from '@renderer/panels/builtin/OutlinePanel';
import { UsagesPanel } from '@renderer/panels/builtin/UsagesPanel';
import { NoticesPanel } from '@renderer/panels/builtin/NoticesPanel';
import { CommitPanel } from '@renderer/panels/builtin/CommitPanel';
import { GitPanel } from '@renderer/panels/builtin/GitPanel';
import { FileTemplateRegistry, templateFileName } from '@renderer/editor/FileTemplateRegistry';
import { CommandRegistry } from '@renderer/commands/CommandRegistry';
import { EditorDocuments } from '@renderer/editor/EditorDocuments';
import { DockLayoutModel } from '@renderer/panels/DockLayoutModel';
import { PanelRegistry } from '@renderer/panels/PanelRegistry';
import { PreviewRegistry } from '@renderer/preview/PreviewRegistry';
import { ModuleBridge } from '@renderer/modules/ModuleBridge';
import { ProjectPanel } from '@renderer/panels/builtin/ProjectPanel';
import { TerminalPanel } from '@renderer/panels/builtin/TerminalPanel';
import { TerminalController } from '@renderer/panels/builtin/TerminalController';

const SAVE_DELAY_MS = 300;

/** Everything one editor window owns: panels, layout, open files, terminals and commands. */
export class EditorWorkspace {
  readonly panels = new PanelRegistry();
  readonly commands = new CommandRegistry();
  readonly fileTemplates = new FileTemplateRegistry();
  readonly previews = new PreviewRegistry();
  readonly documents: EditorDocuments;
  readonly terminals: TerminalController;
  readonly debug: DebugController;
  /** "<line>:<column>" of the active editor's cursor, shown in the status bar. */
  readonly cursor = signal('1:1');
  /** A message in the status bar (from a module, or a problem); click to dismiss. */
  readonly notice = signal<{ text: string; kind: MessageKind } | null>(null);
  readonly modules = new ModuleBridge(this);
  /** Requests from the Project panel's title-bar buttons; the panel acts on each new one. */
  readonly projectTreeRequest = signal<{ action: 'expandAll' | 'collapseAll' | 'refresh'; at: number } | null>(null);
  /** The last Find Usages results, shown in the Usages panel. */
  readonly references = signal<{ symbol: string; list: ReferenceLocation[] } | null>(null);
  /** Settings → Languages: how files with a preview open, by preview id (else the language's default). */
  readonly defaultViews = signal<Record<string, 'code' | 'split' | 'preview'>>({});
  /** Settings → Editor → Format on save. */
  formatOnSave = false;
  /** The editor that last had focus (with a split, one of the two), for commands like Format Document. */
  activeView: EditorView | null = null;
  layout!: DockLayoutModel;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly api: SaturnApi, readonly projectPath: string) {
    this.documents = new EditorDocuments(api);
    this.terminals = new TerminalController(api, projectPath);
    this.debug = new DebugController(api, (frame) => void this.documents.open(frame.path!, { line: frame.line, column: frame.column }));
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

  /** Debugs the open file with its language's debugger; continues instead if the program is paused. */
  async startDebugging(): Promise<void> {
    const state = this.debug.state.value.state;
    if (state === 'stopped') return this.api.debug.continue();
    if (state !== 'idle') return this.layout.show('debug');
    const path = this.documents.activePath.value;
    const language = path ? this.modules.languageFor(path) : undefined;
    if (!path || !language || !this.modules.snapshot.value.debuggers.some((d) => d.languages.includes(language.id))) {
      this.notice.value = { text: path ? "There's no debugger for this file's language" : 'Open a file to debug it', kind: 'info' };
      return;
    }
    this.layout.show('debug');
    await this.debug.start(path, language.id).catch((e: Error) => {
      this.notice.value = { text: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), kind: 'error' };
    });
  }

  showReferences(symbol: string, list: ReferenceLocation[]): void {
    this.references.value = { symbol, list };
    this.layout.show('usages');
  }

  /**
   * Applies edits across the project (a rename): open files change in their editor (unsaved, so they
   * can be undone), others are changed on disk. Resolves to how many files changed.
   */
  async applyEdits(files: FileEdits[]): Promise<number> {
    for (const { path, edits } of files) {
      const open = this.documents.docs.value.find((d) => d.path === path);
      if (open) {
        this.documents.setText(path, applyTextEdits(open.text, edits));
        continue;
      }
      const file = await this.api.fs.readFile(path, { force: true });
      if (file.kind !== 'text') continue;
      const changed = applyTextEdits(file.text.replace(/\r\n/g, '\n'), edits);
      await this.api.fs.writeFile(path, file.eol === 'CRLF' ? changed.replace(/\n/g, '\r\n') : changed);
    }
    return files.length;
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
      actions: () => {
        const ask = (action: 'expandAll' | 'collapseAll' | 'refresh') => (this.projectTreeRequest.value = { action, at: Date.now() });
        return (
          <>
            <IconButton class="size-6" icon={<ExpandAllIcon class="size-3.5" />} label="Expand all" data-testid="project-expand-all" onClick={() => ask('expandAll')} />
            <IconButton class="size-6" icon={<CollapseAllIcon class="size-3.5" />} label="Collapse all" data-testid="project-collapse-all" onClick={() => ask('collapseAll')} />
            <IconButton class="size-6" icon={<RefreshIcon class="size-3.5" />} label="Reload from disk" data-testid="project-refresh" onClick={() => ask('refresh')} />
          </>
        );
      },
    });
    this.panels.register({
      id: 'commit',
      title: 'Commit',
      icon: <CommitIcon />,
      defaultDock: 'left',
      source: 'core',
      render: () => <CommitPanel />,
    });
    this.panels.register({
      id: 'git',
      title: 'Git',
      icon: <GitIcon />,
      defaultDock: 'bottom',
      source: 'core',
      render: () => <GitPanel />,
    });
    this.panels.register({
      id: 'notices',
      title: 'Notices',
      icon: <NoticesIcon />,
      defaultDock: 'bottom',
      source: 'core',
      render: () => <NoticesPanel />,
    });
    this.panels.register({
      id: 'outline',
      title: 'Outline',
      icon: <OutlineIcon />,
      defaultDock: 'left',
      source: 'core',
      render: () => <OutlinePanel />,
    });
    this.panels.register({
      id: 'usages',
      title: 'Usages',
      icon: <UsagesIcon />,
      defaultDock: 'bottom',
      source: 'core',
      render: () => <UsagesPanel />,
    });
    this.panels.register({
      id: 'debug',
      title: 'Debug',
      icon: <DebugIcon />,
      defaultDock: 'bottom',
      source: 'core',
      render: () => <DebugPanel />,
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
    // Shortcuts come from the chosen keymap (shared/keymaps.ts), matched by command id.
    const add = (id: string, title: string, run: () => void | Promise<void>) =>
      this.commands.register({ id: `core.${id}`, title, source, run });

    add('openSettings', 'Open Settings', () => this.api.windows.openSettings());
    add('openMarketplace', 'Open Marketplace', () => this.api.windows.openMarketplace());
    add('toggleTerminal', 'Toggle Terminal', () => this.layout.toggle('terminal'));
    add('toggleProject', 'Toggle Project', () => this.layout.toggle('project'));
    add('saveFile', 'Save File', async () => {
      if (this.formatOnSave && this.activeView) await formatDocument(this.activeView);
      await this.documents.save();
    });
    add('saveAll', 'Save All', () => this.documents.saveAll());
    add('newTerminal', 'New Terminal', async () => {
      await this.terminals.openTerminal();
      this.showTerminal();
    });
    add('splitEditor', 'Split Editor', () => this.documents.toggleSplit());
    // F5 starts debugging the open file, or continues when paused.
    add('startDebugging', 'Start Debugging', () => this.startDebugging());
    add('stopDebugging', 'Stop Debugging', () => this.api.debug.stop());
    add('stepOver', 'Step Over', () => this.api.debug.next());
    add('stepInto', 'Step Into', () => this.api.debug.stepIn());
    add('stepOut', 'Step Out', () => this.api.debug.stepOut());
    // Editor commands also listed in Search Actions; their shortcuts work inside the editor.
    const editor = (id: string, title: string, run: (view: EditorView) => unknown) =>
      this.commands.register({ id: `editor.${id}`, title, source, run: () => void (this.activeView && run(this.activeView)) });
    editor('formatDocument', 'Format Document', formatDocument);
    editor('findReferences', 'Find Usages', findReferences);
    editor('rename', 'Rename Symbol', renameSymbol);
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
