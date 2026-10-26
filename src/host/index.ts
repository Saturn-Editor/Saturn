/**
 * The extension host: a separate process that loads enabled modules and runs their code, so a slow
 * or crashing module can never freeze the editor. Main talks to it over an Rpc channel.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { TreeItem } from '@shared/modules';
import { Rpc } from '@shared/rpc';
import { findFiles } from '../main/Helpers/findFiles';

export interface ModuleContext {
  projectPath: string;
}

export interface TemplateContext extends ModuleContext {
  name: string;
  dir: string;
}

/** The `saturn` object every module's `activate(saturn)` receives. */
export interface SaturnModuleApi {
  platform: NodeJS.Platform;
  commands: { register(id: string, run: (ctx: ModuleContext) => void | Promise<void>): void };
  panels: {
    registerTree(id: string, provider: { getChildren(parentId: string | null, ctx: ModuleContext): TreeItem[] | Promise<TreeItem[]> }): void;
    refresh(id: string): void;
  };
  previews: { registerRenderer(id: string, render: (text: string, ctx: ModuleContext & { path: string }) => string | Promise<string>): void };
  files: {
    registerTemplate(id: string, template: {
      fileName?(ctx: TemplateContext): string;
      content?(ctx: TemplateContext): string | Promise<string>;
    }): void;
  };
  projects: { onCreate(handler: (ctx: ModuleContext & { fields: Record<string, string | boolean> }) => void | Promise<void>): void };
  run: { registerProvider(provide: (ctx: ModuleContext) => { name: string; command: string }[] | Promise<{ name: string; command: string }[]>): void };
  workspace: {
    findFiles(projectPath: string, glob: string): Promise<string[]>;
    openFile(projectPath: string, path: string, line?: number): void;
  };
}

interface LoadedModule {
  id: string;
  dir: string;
  main?: string;
}

type Fn = (...args: any[]) => any;

class ExtensionHost {
  private readonly rpc = new Rpc((message) => process.parentPort.postMessage(message));
  private readonly commands = new Map<string, Fn>();
  private readonly trees = new Map<string, { getChildren: Fn }>();
  private readonly previews = new Map<string, Fn>();
  private readonly templates = new Map<string, { fileName?: Fn; content?: Fn }>();
  private readonly projectHandlers = new Map<string, Fn>();
  private readonly runProviders = new Map<string, Fn>();

  start(): void {
    process.parentPort.on('message', (e) => this.rpc.receive(e.data));
    this.rpc.handle('activate', (modules: LoadedModule[]) => this.activateAll(modules));
    this.rpc.handle('runCommand', (id: string, ctx: ModuleContext) => this.need(this.commands, id, 'command')(ctx));
    this.rpc.handle('treeChildren', (id: string, parentId: string | null, ctx: ModuleContext) =>
      this.need(this.trees, id, 'panel').getChildren(parentId, ctx));
    this.rpc.handle('renderPreview', (id: string, text: string, ctx: ModuleContext & { path: string }) =>
      this.need(this.previews, id, 'preview')(text, ctx));
    this.rpc.handle('templateFile', async (id: string, ctx: TemplateContext) => {
      const t = this.templates.get(id);
      return { fileName: t?.fileName?.(ctx) ?? null, content: (await t?.content?.(ctx)) ?? '' };
    });
    this.rpc.handle('createProject', (moduleId: string, ctx: ModuleContext & { fields: Record<string, string | boolean> }) =>
      this.projectHandlers.get(moduleId)?.(ctx));
    this.rpc.handle('runEntries', async (ctx: ModuleContext) => {
      const all: { moduleId: string; name: string; command: string }[] = [];
      for (const [moduleId, provide] of this.runProviders) {
        try {
          all.push(...((await provide(ctx)) as { name: string; command: string }[]).map((e) => ({ ...e, moduleId })));
        } catch (e) {
          console.error(`[${moduleId}] run provider failed`, e);
        }
      }
      return all;
    });
  }

  private async activateAll(modules: LoadedModule[]): Promise<{ id: string; error: string }[]> {
    const failures: { id: string; error: string }[] = [];
    for (const m of modules) {
      if (!m.main) continue;
      try {
        const mod = await import(/* @vite-ignore */ pathToFileURL(join(m.dir, m.main)).href);
        await mod.activate?.(this.apiFor(m.id));
      } catch (e) {
        failures.push({ id: m.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return failures;
  }

  private apiFor(moduleId: string): SaturnModuleApi {
    return {
      platform: process.platform,
      commands: { register: (id, run) => void this.commands.set(id, run) },
      panels: {
        registerTree: (id, provider) => void this.trees.set(id, provider),
        refresh: (id) => this.rpc.notify('refreshPanel', id),
      },
      previews: { registerRenderer: (id, render) => void this.previews.set(id, render) },
      files: { registerTemplate: (id, template) => void this.templates.set(id, template) },
      projects: { onCreate: (handler) => void this.projectHandlers.set(moduleId, handler) },
      run: { registerProvider: (provide) => void this.runProviders.set(moduleId, provide) },
      workspace: {
        findFiles: (projectPath, glob) => findFiles(projectPath, glob),
        openFile: (projectPath, path, line) => this.rpc.notify('openFile', projectPath, path, line),
      },
    };
  }

  private need<T>(map: Map<string, T>, id: string, what: string): T {
    const found = map.get(id);
    if (!found) throw new Error(`No ${what} handler registered for ${id}`);
    return found;
  }
}

new ExtensionHost().start();
