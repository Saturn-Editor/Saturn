import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { TreeItem } from '@shared/modules';
import { Rpc } from '@shared/rpc';
import type { InstalledModule } from './ModuleService';

export interface HostEvents {
  openFile(projectPath: string, path: string, line?: number): void;
  refreshPanel(panelId: string): void;
  crashed(reason: string): void;
}

type Ctx = { projectPath: string };

/** Runs the extension host process and forwards calls to the modules loaded in it. */
export class ExtensionHostService {
  private child: UtilityProcess | null = null;
  private rpc: Rpc | null = null;
  private ready: Promise<void> = Promise.resolve();

  constructor(private readonly events: HostEvents) {}

  /** (Re)starts the host with the given modules. Calls made meanwhile wait for activation. */
  restart(modules: InstalledModule[]): Promise<void> {
    this.stop();
    const child = utilityProcess.fork(join(import.meta.dirname, 'host.js'), [], { serviceName: 'Saturn Extension Host' });
    const rpc = new Rpc((message) => child.postMessage(message));
    rpc.handle('openFile', (projectPath: string, path: string, line?: number) => this.events.openFile(projectPath, path, line));
    rpc.handle('refreshPanel', (panelId: string) => this.events.refreshPanel(panelId));
    child.on('message', (message) => rpc.receive(message));
    child.on('exit', (code) => {
      rpc.rejectAll('The extension host stopped');
      if (this.child === child) {
        this.child = null;
        this.rpc = null;
        this.events.crashed(`The extension host stopped (code ${code}). Languages are unavailable until Saturn restarts them.`);
      }
    });
    this.child = child;
    this.rpc = rpc;
    const loadable = modules.map((m) => ({ id: m.manifest.id, dir: m.dir, main: m.manifest.main }));
    this.ready = rpc.call<{ id: string; error: string }[]>('activate', loadable).then((failures) => {
      for (const f of failures) console.error(`Module ${f.id} failed to activate: ${f.error}`);
    });
    return this.ready;
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.rpc?.rejectAll('The extension host restarted');
    this.rpc = null;
    child?.kill();
  }

  runCommand(id: string, ctx: Ctx): Promise<void> {
    return this.call('runCommand', id, ctx);
  }

  treeChildren(panelId: string, parentId: string | null, ctx: Ctx): Promise<TreeItem[]> {
    return this.call('treeChildren', panelId, parentId, ctx);
  }

  renderPreview(id: string, text: string, ctx: Ctx & { path: string }): Promise<string> {
    return this.call('renderPreview', id, text, ctx);
  }

  templateFile(id: string, ctx: Ctx & { name: string; dir: string }): Promise<{ fileName: string | null; content: string }> {
    return this.call('templateFile', id, ctx);
  }

  createProject(moduleId: string, ctx: Ctx & { fields: Record<string, string | boolean> }): Promise<void> {
    return this.call('createProject', moduleId, ctx);
  }

  runEntries(ctx: Ctx): Promise<{ moduleId: string; name: string; command: string }[]> {
    return this.call('runEntries', ctx);
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.ready;
    if (!this.rpc) throw new Error('The extension host is not running');
    return this.rpc.call<T>(method, ...args);
  }
}
