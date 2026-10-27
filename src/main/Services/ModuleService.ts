import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SATURN_API_VERSION, satisfiesCaret, settingDefaults, type ContributionSnapshot, type ModuleManifest, type ModuleSummary,
  type SettingValue, type SettingValues,
} from '@shared/modules';
import { findFiles } from '../Helpers/findFiles';
import type { ModuleSettingsStore } from '../Store/ModuleSettingsStore';
import type { ModuleStateStore } from '../Store/ModuleStateStore';

export const MANIFEST_FILE = 'saturn-module.json';

export interface InstalledModule {
  manifest: ModuleManifest;
  dir: string;
  enabled: boolean;
  incompatible: string | null;
  /** Its contributed settings' values (stored, else the manifest defaults). */
  settings: SettingValues;
}

const ID = /^[a-z0-9][a-z0-9.-]*$/;

/** Reads, installs, enables and removes language modules kept in `<appData>/modules/<id>/`. */
export class ModuleService {
  private readonly listeners: (() => void)[] = [];
  private readonly settingsListeners: ((moduleId: string, values: SettingValues) => void)[] = [];

  constructor(
    private readonly modulesDir: string,
    private readonly state: ModuleStateStore,
    private readonly settingsStore: ModuleSettingsStore,
  ) {}

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
      const settings = await this.valuesFor(manifest);
      modules.push({ manifest, dir, enabled: !disabled.has(manifest.id), incompatible, settings });
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
    await this.settingsStore.forget(id);
    this.emit();
  }

  /** Called when one module's settings change (no restart; the host and its language server are told). */
  onSettingsChanged(listener: (moduleId: string, values: SettingValues) => void): void {
    this.settingsListeners.push(listener);
  }

  async settings(moduleId: string): Promise<SettingValues> {
    const found = (await this.list()).find((m) => m.manifest.id === moduleId);
    if (!found) throw new Error(`Unknown module: ${moduleId}`);
    return found.settings;
  }

  /** Saves one value; it must be a setting the module declares, with a matching type. */
  async setSetting(moduleId: string, id: string, value: SettingValue): Promise<void> {
    const found = (await this.list()).find((m) => m.manifest.id === moduleId);
    const setting = found?.manifest.contributes?.settings?.find((s) => s.id === id);
    if (!found || !setting) throw new Error(`Unknown setting: ${moduleId}.${id}`);
    if ((setting.type === 'checkbox') !== (typeof value === 'boolean')) throw new Error(`Wrong value type for ${setting.label}`);
    await this.settingsStore.set(moduleId, id, value);
    const values = await this.valuesFor(found.manifest);
    this.settingsListeners.forEach((l) => l(moduleId, values));
  }

  private async valuesFor(manifest: ModuleManifest): Promise<SettingValues> {
    const declared = manifest.contributes?.settings ?? [];
    const stored = await this.settingsStore.values(manifest.id);
    const values = settingDefaults(declared);
    for (const s of declared) if (stored[s.id] !== undefined) values[s.id] = stored[s.id];
    return values;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.state.setEnabled(id, enabled);
    this.emit();
  }

  async snapshot(): Promise<ContributionSnapshot> {
    const snap: ContributionSnapshot = { languages: [], panels: [], commands: [], previews: [], fileTemplates: [], newProject: [], settings: [] };
    for (const { manifest: m } of await this.active()) {
      const c = m.contributes ?? {};
      const badge = m.badge ?? m.name.slice(0, 2).toUpperCase();
      const served = new Set(c.languageServer?.languages ?? []);
      snap.languages.push(...(c.languages ?? []).map((l) => ({ ...l, moduleId: m.id, badge, hasServer: served.has(l.id) })));
      snap.panels.push(...(c.panels ?? []).map((p) => ({ ...p, badge: p.badge ?? badge, moduleId: m.id })));
      snap.commands.push(...(c.commands ?? []).map((cmd) => ({ ...cmd, moduleId: m.id, moduleName: m.name, badge })));
      snap.previews.push(...(c.previews ?? []).map((p) => ({ ...p, moduleId: m.id })));
      snap.fileTemplates.push(...(c.fileTemplates ?? []).map((t) => ({ ...t, moduleId: m.id })));
      if (c.settings?.length) snap.settings.push({ moduleId: m.id, moduleName: m.name, badge, items: c.settings });
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

  /**
   * A grammar by TextMate scope name, from any active module. Lets one language's grammar embed
   * another's, e.g. PHP pulling in "text.html.basic" from the HTML module.
   */
  async grammarByScope(scopeName: string): Promise<unknown | null> {
    for (const { manifest, dir } of await this.active()) {
      for (const lang of manifest.contributes?.languages ?? []) {
        if (!lang.grammar) continue;
        if (lang.scopeName && lang.scopeName !== scopeName) continue;
        const raw = JSON.parse(await readFile(join(dir, lang.grammar), 'utf8')) as { scopeName?: string };
        if (raw.scopeName === scopeName) return raw;
      }
    }
    return null;
  }

  /** Every language whose module's `workspaceContains:` events match the project, e.g. ["php", "javascript"]. */
  async detectLanguages(projectPath: string): Promise<string[]> {
    const found: string[] = [];
    for (const { manifest } of await this.active()) {
      const globs = (manifest.activationEvents ?? []).filter((e) => e.startsWith('workspaceContains:')).map((e) => e.slice(18));
      for (const glob of globs) {
        if ((await findFiles(projectPath, glob, 1)).length > 0) {
          const id = manifest.contributes?.languages?.[0]?.id;
          if (id) found.push(id);
          break;
        }
      }
    }
    return found;
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
