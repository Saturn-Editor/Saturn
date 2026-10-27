import { existsSync } from 'node:fs';
import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  featureKey, ICON_FILE_NAME, ICON_FILES, ICON_SCHEME, LANGUAGE_FEATURES, MANIFEST_FILES, type LanguageFeature, SATURN_API_VERSION, satisfiesCaret, settingDefaults, type ContributionSnapshot, type LanguageManifest,
  type ModuleKind, type ModuleManifest, type ModuleSummary, type SettingValue, type SettingValues,
} from '@shared/modules';
import { findFiles } from '../Helpers/findFiles';
import type { ModuleSettingsStore } from '../Store/ModuleSettingsStore';
import type { ModuleStateStore } from '../Store/ModuleStateStore';

export interface InstalledModule {
  kind: ModuleKind;
  manifest: ModuleManifest;
  dir: string;
  enabled: boolean;
  incompatible: string | null;
  /** Its contributed settings' values (stored, else the manifest defaults). */
  settings: SettingValues;
  /** A writable folder of its own that survives updates (e.g. for downloaded tools); created on first use. */
  storageDir: string;
}

/** An installed language, whose manifest may contribute languages, servers, previews and templates. */
export type InstalledLanguage = InstalledModule & { manifest: LanguageManifest };

const ID = /^[a-z0-9][a-z0-9.-]*$/;

/** The features a language's server declares (all of them when it doesn't say); none for modules without a server. */
function declaredFeatures(m: ModuleManifest): LanguageFeature[] {
  const server = (m as LanguageManifest).contributes?.languageServer;
  if (!server) return [];
  return server.features ?? LANGUAGE_FEATURES.map((f) => f.id);
}

/** The module's icon as a saturn-icon:// URL if it ships icon.svg or icon.png (versioned, so updates show), else null. */
function iconUrl(dir: string, m: ModuleManifest): string | null {
  return ICON_FILES.some((f) => existsSync(join(dir, f))) ? `${ICON_SCHEME}://module/${m.id}?v=${encodeURIComponent(m.version)}` : null;
}
const KIND_NAMES: Record<ModuleKind, string> = { language: 'language', extension: 'extension' };

/**
 * Reads, installs, enables and removes code modules: languages in `<appData>/languages/<id>/`
 * (saturn-language.json) and extensions in `<appData>/extensions/<id>/` (saturn-extension.json).
 * Ids are unique across both kinds, since settings and commands are keyed by them.
 */
export class CodeModuleService {
  private readonly listeners: (() => void)[] = [];
  private readonly settingsListeners: ((moduleId: string, values: SettingValues) => void)[] = [];

  constructor(
    private readonly dirs: Record<ModuleKind, string>,
    private readonly state: ModuleStateStore,
    private readonly settingsStore: ModuleSettingsStore,
    /** Parent of each module's storage folder (`<storageRoot>/<id>`). */
    private readonly storageRoot: string,
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

  /** Installed modules of one kind, or of both. */
  async list(kind?: ModuleKind): Promise<InstalledModule[]> {
    const kinds: ModuleKind[] = kind ? [kind] : ['language', 'extension'];
    const disabled = await this.state.disabled();
    const modules: InstalledModule[] = [];
    for (const k of kinds) {
      let names: string[] = [];
      try {
        names = (await readdir(this.dirs[k], { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        continue;
      }
      for (const name of names.sort()) {
        const dir = join(this.dirs[k], name);
        const manifest = await this.readManifest(k, dir).catch(() => null);
        if (!manifest) continue;
        const incompatible = satisfiesCaret(manifest.saturnApi, SATURN_API_VERSION)
          ? null
          : `Needs Saturn API ${manifest.saturnApi}; this version provides ${SATURN_API_VERSION}`;
        const settings = await this.valuesFor(manifest);
        modules.push({ kind: k, manifest, dir, enabled: !disabled.has(manifest.id), incompatible, settings, storageDir: join(this.storageRoot, manifest.id) });
      }
    }
    return modules;
  }

  /** Enabled modules that can actually load. */
  async active(kind?: ModuleKind): Promise<InstalledModule[]> {
    return (await this.list(kind)).filter((m) => m.enabled && !m.incompatible);
  }

  /** Enabled languages that can load (for the language servers and highlighting). */
  async activeLanguages(): Promise<InstalledLanguage[]> {
    return (await this.active('language')) as InstalledLanguage[];
  }

  async summaries(kind: ModuleKind): Promise<ModuleSummary[]> {
    return (await this.list(kind)).map(({ manifest: m, dir, enabled, incompatible }) => ({
      kind,
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description ?? '',
      badge: m.badge ?? m.name.slice(0, 2).toUpperCase(),
      icon: iconUrl(dir, m),
      enabled,
      incompatible,
      languages: ((m as LanguageManifest).contributes?.languages ?? []).flatMap((l) => l.extensions),
    }));
  }

  /** Copies a module folder into app-data, replacing any older copy with the same id. */
  async install(kind: ModuleKind, fromDir: string): Promise<ModuleManifest> {
    const manifest = await this.readManifest(kind, fromDir);
    if (!satisfiesCaret(manifest.saturnApi, SATURN_API_VERSION)) {
      throw new Error(`${manifest.name} needs Saturn API ${manifest.saturnApi}; this version provides ${SATURN_API_VERSION}`);
    }
    const other: ModuleKind = kind === 'language' ? 'extension' : 'language';
    if ((await this.list(other)).some((m) => m.manifest.id === manifest.id)) {
      throw new Error(`An ${KIND_NAMES[other]} with the id ${manifest.id} is already installed`);
    }
    const target = join(this.dirs[kind], manifest.id);
    await rm(target, { recursive: true, force: true });
    await cp(fromDir, target, { recursive: true });
    await this.state.setEnabled(manifest.id, true);
    this.emit();
    return manifest;
  }

  async uninstall(kind: ModuleKind, id: string): Promise<void> {
    if (!ID.test(id)) throw new Error(`Unknown ${KIND_NAMES[kind]}: ${id}`);
    await rm(join(this.dirs[kind], id), { recursive: true, force: true });
    await this.state.forget(id);
    await this.settingsStore.forget(id);
    await rm(join(this.storageRoot, id), { recursive: true, force: true });
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
    // Language feature switches ("feature:<name>") are booleans for features the server declares.
    const isFeature = !!found && declaredFeatures(found.manifest).some((f) => featureKey(f) === id);
    const setting = found?.manifest.contributes?.settings?.find((s) => s.id === id);
    if (!found || (!setting && !isFeature)) throw new Error(`Unknown setting: ${moduleId}.${id}`);
    const wantsBoolean = isFeature || setting?.type === 'checkbox';
    if (wantsBoolean !== (typeof value === 'boolean')) throw new Error(`Wrong value type for ${setting?.label ?? id}`);
    await this.settingsStore.set(moduleId, id, value);
    const values = await this.valuesFor(found.manifest);
    this.settingsListeners.forEach((l) => l(moduleId, values));
  }

  private async valuesFor(manifest: ModuleManifest): Promise<SettingValues> {
    const declared = manifest.contributes?.settings ?? [];
    const stored = await this.settingsStore.values(manifest.id);
    const values = settingDefaults(declared);
    for (const s of declared) if (stored[s.id] !== undefined) values[s.id] = stored[s.id];
    for (const f of declaredFeatures(manifest)) values[featureKey(f)] = stored[featureKey(f)] !== false;
    return values;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.state.setEnabled(id, enabled);
    this.emit();
  }

  /** What every active module contributes. Language-only parts are read from languages only. */
  async snapshot(): Promise<ContributionSnapshot> {
    const snap: ContributionSnapshot = { languages: [], panels: [], commands: [], previews: [], fileTemplates: [], newProject: [], settings: [], buttons: [], debuggers: [] };
    for (const { kind, manifest: m, dir, settings } of await this.active()) {
      const c = m.contributes ?? {};
      const badge = m.badge ?? m.name.slice(0, 2).toUpperCase();
      const icon = iconUrl(dir, m);
      // A panel's or button's own icon file, if it names one that exists, else the module's icon.
      const ownIcon = (file?: string) => (file && ICON_FILE_NAME.test(file) && existsSync(join(dir, file))
        ? `${ICON_SCHEME}://module/${m.id}/${file.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(m.version)}`
        : icon);
      snap.panels.push(...(c.panels ?? []).map((p) => ({ ...p, iconUrl: ownIcon(p.icon), moduleId: m.id })));
      snap.commands.push(...(c.commands ?? []).map((cmd) => ({ ...cmd, moduleId: m.id, moduleName: m.name, badge, icon })));
      snap.buttons.push(...(c.buttons ?? []).map((b) => ({ ...b, iconUrl: ownIcon(b.icon), moduleId: m.id })));
      const lc = kind === 'language' ? ((m as LanguageManifest).contributes ?? {}) : {};
      const declared = declaredFeatures(m);
      // A Settings tab for modules with settings, a language server whose features can be switched off,
      // or previews (whose default view can be chosen).
      const previews = kind === 'language' ? ((m as LanguageManifest).contributes?.previews ?? []) : [];
      if (c.settings?.length || declared.length || previews.length) snap.settings.push({ moduleId: m.id, moduleName: m.name, badge, icon, items: c.settings ?? [], features: declared });
      if (kind !== 'language') continue;
      const served = new Set(lc.languageServer?.languages ?? []);
      const enabled = declared.filter((f) => settings[featureKey(f)] !== false);
      snap.languages.push(...(lc.languages ?? []).map((l) => ({
        ...l, moduleId: m.id, badge, icon, hasServer: served.has(l.id), features: served.has(l.id) ? enabled : [],
      })));
      if (lc.debugger) {
        snap.debuggers.push({
          moduleId: m.id,
          label: lc.debugger.label,
          languages: lc.debugger.languages,
          configurations: (lc.debugger.configurations ?? []).map(({ id, label }) => ({ id, label })),
          canAttach: !!lc.debugger.attach,
        });
      }
      snap.previews.push(...(lc.previews ?? []).map((p) => ({ ...p, moduleId: m.id })));
      snap.fileTemplates.push(...(lc.fileTemplates ?? []).map((t) => ({ ...t, moduleId: m.id })));
      if (lc.newProject) {
        const languageName = lc.languages?.find((l) => l.id === lc.newProject!.language)?.name ?? m.name;
        // A field default of "${setting:<id>}" shows that module setting's current value.
        const fields = lc.newProject.fields.map((f) => {
          const ref = typeof f.default === 'string' ? /^\$\{setting:([\w.-]+)\}$/.exec(f.default) : null;
          return ref ? { ...f, default: settings[ref[1]] ?? '' } : f;
        });
        snap.newProject.push({ ...lc.newProject, fields, moduleId: m.id, languageName, badge, icon });
      }
    }
    return snap;
  }

  /** Reads a grammar file of an active language, for the renderer's highlighter. */
  async grammar(languageId: string): Promise<unknown | null> {
    for (const { manifest, dir } of await this.activeLanguages()) {
      const lang = manifest.contributes?.languages?.find((l) => l.id === languageId);
      if (lang?.grammar) return JSON.parse(await readFile(join(dir, lang.grammar), 'utf8'));
    }
    return null;
  }

  /**
   * A grammar by TextMate scope name, from any active language. Lets one language's grammar embed
   * another's, e.g. PHP pulling in "text.html.basic" from the HTML language.
   */
  async grammarByScope(scopeName: string): Promise<unknown | null> {
    for (const { manifest, dir } of await this.activeLanguages()) {
      for (const lang of manifest.contributes?.languages ?? []) {
        if (!lang.grammar) continue;
        if (lang.scopeName && lang.scopeName !== scopeName) continue;
        const raw = JSON.parse(await readFile(join(dir, lang.grammar), 'utf8')) as { scopeName?: string };
        if (raw.scopeName === scopeName) return raw;
      }
    }
    return null;
  }

  /** Every language whose `workspaceContains:` events match the project, e.g. ["php", "javascript"]. */
  async detectLanguages(projectPath: string): Promise<string[]> {
    const found: string[] = [];
    for (const { manifest } of await this.activeLanguages()) {
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

  private async readManifest(kind: ModuleKind, dir: string): Promise<ModuleManifest> {
    const file = MANIFEST_FILES[kind];
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(dir, file), 'utf8'));
    } catch {
      throw new Error(`No valid ${file} in that folder`);
    }
    if (!CodeModuleService.validate(parsed)) throw new Error(`${file} is missing id, name, version or saturnApi`);
    return parsed;
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}
