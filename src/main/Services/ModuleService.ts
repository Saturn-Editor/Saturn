import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SATURN_API_VERSION, satisfiesCaret, type ContributionSnapshot, type ModuleManifest, type ModuleSummary,
} from '@shared/modules';
import { findFiles } from '../Helpers/findFiles';
import type { ModuleStateStore } from '../Store/ModuleStateStore';

export const MANIFEST_FILE = 'saturn-module.json';

export interface InstalledModule {
  manifest: ModuleManifest;
  dir: string;
  enabled: boolean;
  incompatible: string | null;
}

const ID = /^[a-z0-9][a-z0-9.-]*$/;

/** Reads, installs, enables and removes language modules kept in `<appData>/modules/<id>/`. */
export class ModuleService {
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly modulesDir: string, private readonly state: ModuleStateStore) {}

  static validate(v: unknown): v is ModuleManifest {
    const m = v as ModuleManifest;
    return typeof m === 'object' && m !== null && typeof m.id === 'string' && ID.test(m.id) &&
      typeof m.name === 'string' && typeof m.version === 'string' && typeof m.saturnApi === 'string';
  }

  /** Called after any install, uninstall or enable change. */
  onChanged(listener: () => void): void {
    this.listeners.push(listener);
  }

  async list(): Promise<InstalledModule[]> {
    const disabled = await this.state.disabled();
    let names: string[] = [];
    try {
      names = (await readdir(this.modulesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    const modules: InstalledModule[] = [];
    for (const name of names.sort()) {
      const dir = join(this.modulesDir, name);
      const manifest = await this.readManifest(dir).catch(() => null);
      if (!manifest) continue;
      const incompatible = satisfiesCaret(manifest.saturnApi, SATURN_API_VERSION)
        ? null
        : `Needs Saturn API ${manifest.saturnApi}; this version provides ${SATURN_API_VERSION}`;
      modules.push({ manifest, dir, enabled: !disabled.has(manifest.id), incompatible });
    }
    return modules;
  }

  /** Enabled modules that can actually load. */
  async active(): Promise<InstalledModule[]> {
    return (await this.list()).filter((m) => m.enabled && !m.incompatible);
  }

  async summaries(): Promise<ModuleSummary[]> {
    return (await this.list()).map(({ manifest: m, enabled, incompatible }) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description ?? '',
      badge: m.badge ?? m.name.slice(0, 2).toUpperCase(),
      enabled,
      incompatible,
      languages: (m.contributes?.languages ?? []).flatMap((l) => l.extensions),
    }));
  }

  /** Copies a module folder into app-data, replacing any older copy with the same id. */
  async install(fromDir: string): Promise<ModuleManifest> {
    const manifest = await this.readManifest(fromDir);
    if (!satisfiesCaret(manifest.saturnApi, SATURN_API_VERSION)) {
      throw new Error(`${manifest.name} needs Saturn API ${manifest.saturnApi}; this version provides ${SATURN_API_VERSION}`);
    }
    const target = join(this.modulesDir, manifest.id);
    await rm(target, { recursive: true, force: true });
    await cp(fromDir, target, { recursive: true });
    await this.state.setEnabled(manifest.id, true);
    this.emit();
    return manifest;
  }

  async uninstall(id: string): Promise<void> {
    if (!ID.test(id)) throw new Error(`Unknown module: ${id}`);
    await rm(join(this.modulesDir, id), { recursive: true, force: true });
    await this.state.forget(id);
    this.emit();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.state.setEnabled(id, enabled);
    this.emit();
  }

  async snapshot(): Promise<ContributionSnapshot> {
    const snap: ContributionSnapshot = { languages: [], panels: [], commands: [], previews: [], fileTemplates: [], newProject: [] };
    for (const { manifest: m } of await this.active()) {
      const c = m.contributes ?? {};
      const badge = m.badge ?? m.name.slice(0, 2).toUpperCase();
      const served = new Set(c.languageServer?.languages ?? []);
      snap.languages.push(...(c.languages ?? []).map((l) => ({ ...l, moduleId: m.id, badge, hasServer: served.has(l.id) })));
      snap.panels.push(...(c.panels ?? []).map((p) => ({ ...p, badge: p.badge ?? badge, moduleId: m.id })));
      snap.commands.push(...(c.commands ?? []).map((cmd) => ({ ...cmd, moduleId: m.id, moduleName: m.name, badge })));
      snap.previews.push(...(c.previews ?? []).map((p) => ({ ...p, moduleId: m.id })));
      snap.fileTemplates.push(...(c.fileTemplates ?? []).map((t) => ({ ...t, moduleId: m.id })));
      if (c.newProject) {
        const languageName = c.languages?.find((l) => l.id === c.newProject!.language)?.name ?? m.name;
        snap.newProject.push({ ...c.newProject, moduleId: m.id, languageName, badge });
      }
    }
    return snap;
  }

  /** Reads a grammar file of an active module, for the renderer's highlighter. */
  async grammar(languageId: string): Promise<unknown | null> {
    for (const { manifest, dir } of await this.active()) {
      const lang = manifest.contributes?.languages?.find((l) => l.id === languageId);
      if (lang?.grammar) return JSON.parse(await readFile(join(dir, lang.grammar), 'utf8'));
    }
    return null;
  }

  /** The language of the first active module whose `workspaceContains:` event matches the project. */
  async detectLanguage(projectPath: string): Promise<string | null> {
    for (const { manifest } of await this.active()) {
      const globs = (manifest.activationEvents ?? []).filter((e) => e.startsWith('workspaceContains:')).map((e) => e.slice(18));
      for (const glob of globs) {
        if ((await findFiles(projectPath, glob, 1)).length > 0) return manifest.contributes?.languages?.[0]?.id ?? null;
      }
    }
    return null;
  }

  private async readManifest(dir: string): Promise<ModuleManifest> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
    } catch {
      throw new Error(`No valid ${MANIFEST_FILE} in that folder`);
    }
    if (!ModuleService.validate(parsed)) throw new Error(`${MANIFEST_FILE} is missing id, name, version or saturnApi`);
    return parsed;
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}
