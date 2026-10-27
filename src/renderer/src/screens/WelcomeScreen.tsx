import { useEffect, useState } from 'preact/hooks';
import type { ContributionSnapshot, ModuleLook } from '@shared/modules';
import type { RecentProject } from '@shared/types';
import { Button, FormField, LanguageBadges, Logo, SidebarMenu, TextInput } from '@renderer/components';
import { EMPTY_SNAPSHOT, projectBadges } from '@renderer/modules/ModuleBridge';
import { AboutPage } from './AboutPage';
import { MarketplaceScreen } from './MarketplaceScreen';
import { SettingsScreen } from './SettingsScreen';

type Page = 'projects' | 'marketplace' | 'settings' | 'about';
/** Every page shows inside the Welcome window; Settings and Marketplace are the same screens as their own windows. */
type LocalPage = Page;


function ProjectRow({ project, badges, onOpen, onRemove }: { project: RecentProject; badges: ModuleLook[]; onOpen: () => void; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div class="hover:bg-hover">
      <div
        role="button"
        data-testid="recent-project"
        onClick={() => (project.missing ? setConfirming(true) : onOpen())}
        class={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer ${project.missing ? 'text-muted' : ''}`}
      >
        <span class={`font-semibold shrink-0 ${project.missing ? '' : 'text-strong'}`}>{project.name}</span>
        <span class="flex-1 text-muted truncate">{project.path}{project.missing && ' (missing)'}</span>
        {/* The project's language icons, pinned to the right. */}
        <LanguageBadges badges={badges} />
      </div>
      {confirming && (
        <div class="flex items-center gap-2 px-2.5 pb-2">
          <span class="text-muted">This folder no longer exists.</span>
          <Button onClick={onRemove}>Remove from list</Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

/** Clone a repository (system git) into a new folder inside the chosen location, then open it. */
function CloneForm({ onCancel }: { onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => void window.saturn.projects.defaultParentDir().then(setParentDir), []);

  const clone = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await window.saturn.projects.clone(url, parentDir);
    } catch (e) {
      setProblem(String((e as Error).message).replace(/^.*Error: /, ''));
      setBusy(false);
    }
  };

  return (
    <div class="flex flex-col gap-2 mb-3.5 p-2.5 border border-border bg-panel" data-testid="clone-form">
      <FormField label="Repository URL">
        <TextInput value={url} onInput={setUrl} placeholder="https://github.com/owner/repo.git" testId="clone-url" autoFocus />
      </FormField>
      <FormField label="Into folder">
        <div class="flex gap-2">
          <TextInput class="flex-1" value={parentDir} onInput={setParentDir} testId="clone-parent" />
          <Button onClick={() => void window.saturn.projects.pickFolder().then((p) => p && setParentDir(p))}>Browse…</Button>
        </div>
      </FormField>
      {problem && <p class="m-0 text-accent break-words" role="alert">{problem}</p>}
      <div class="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" testId="clone-start" disabled={busy || !url.trim()} onClick={() => void clone()}>{busy ? 'Cloning…' : 'Clone'}</Button>
      </div>
    </div>
  );
}

export function WelcomeScreen() {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [query, setQuery] = useState('');
  const [modules, setModules] = useState<ContributionSnapshot>(EMPTY_SNAPSHOT);
  const [page, setPage] = useState<LocalPage>('projects');
  const [cloning, setCloning] = useState(false);

  const load = () => void window.saturn.projects.recent().then(setProjects);
  useEffect(() => {
    load();
    void window.saturn.modules.snapshot().then(setModules);
    window.addEventListener('focus', load);
    const stop = window.saturn.modules.onChanged(setModules);
    return () => {
      window.removeEventListener('focus', load);
      stop();
    };
  }, []);

  const select = (target: Page) => setPage(target);

  const badgesFor = (p: RecentProject) => projectBadges(modules, p.languageIds);

  const open = async (p: RecentProject) => {
    if ((await window.saturn.projects.openPath(p.path)) === 'missing') load();
  };

  const q = query.trim().toLowerCase();
  const visible = projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));

  return (
    <div class="flex h-full" data-testid="screen-welcome">
      <SidebarMenu<Page>
        header={<div class="px-3.5 pt-3.5 pb-4"><Logo class="h-8" /></div>}
        items={[
          { id: 'projects', label: 'Projects' },
          { id: 'marketplace', label: 'Marketplace' },
          { id: 'settings', label: 'Settings' },
        ]}
        bottomItems={[{ id: 'about', label: 'About' }]}
        selected={page}
        onSelect={select}
      />
      {page === 'settings' && <div class="flex-1 min-w-0" data-testid="welcome-settings"><SettingsScreen embedded /></div>}
      {page === 'marketplace' && <div class="flex-1 min-w-0" data-testid="welcome-marketplace"><MarketplaceScreen embedded /></div>}
      {page === 'about' && <AboutPage />}
      {page === 'projects' && (
      <main class="flex-1 flex flex-col p-3.5 min-w-0">
        <div class="flex gap-2 mb-3.5">
          <TextInput class="flex-1" value={query} onInput={setQuery} placeholder="Search projects" />
          <Button variant="primary" testId="welcome-new" onClick={() => window.saturn.windows.openNewProject()}>New</Button>
          <Button testId="welcome-open" onClick={() => void window.saturn.projects.openDialog()}>Open</Button>
          <Button testId="welcome-clone" onClick={() => setCloning(!cloning)}>Clone</Button>
        </div>
        {cloning && <CloneForm onCancel={() => setCloning(false)} />}
        <div class="flex-1 overflow-y-auto">
          {visible.map((p) => (
            <ProjectRow
              key={p.path}
              project={p}
              badges={badgesFor(p)}
              onOpen={() => void open(p)}
              onRemove={() => void window.saturn.projects.removeRecent(p.path).then(load)}
            />
          ))}
          {projects.length === 0 && <p class="text-muted px-2.5">No recent projects yet. Create or open one to get started.</p>}
        </div>
      </main>
      )}
    </div>
  );
}
