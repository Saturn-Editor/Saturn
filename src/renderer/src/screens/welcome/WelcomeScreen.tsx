import { useEffect, useState } from 'preact/hooks';
import type { ContributionSnapshot } from '@shared/modules';
import type { RecentProject } from '@shared/types';
import appIconUrl from '../../../../../resources/icons/icon.svg?url';
import { Badge, Button, SidebarNav, TextInput } from '@renderer/components';
import { EMPTY_SNAPSHOT } from '@renderer/modules/ModuleBridge';

type Page = 'projects' | 'marketplace' | 'settings';

function SaturnHeader() {
  return (
    <div class="flex items-center gap-2 px-3.5 pt-3.5 pb-4">
      <img src={appIconUrl} alt="" class="size-7" />
      <div>
        <div class="font-semibold text-strong">Saturn</div>
        <div class="text-muted" data-testid="app-version">{__SATURN_VERSION__}</div>
      </div>
    </div>
  );
}

function ProjectRow({ project, badge, onOpen, onRemove }: { project: RecentProject; badge: string; onOpen: () => void; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div class="hover:bg-hover">
      <div
        role="button"
        data-testid="recent-project"
        onClick={() => (project.missing ? setConfirming(true) : onOpen())}
        class={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer ${project.missing ? 'text-muted' : ''}`}
      >
        <Badge text={badge} />
        <span class={`font-semibold ${project.missing ? '' : 'text-strong'}`}>{project.name}</span>
        <span class="text-muted truncate">{project.path}{project.missing && ' (missing)'}</span>
      </div>
      {confirming && (
        <div class="flex items-center gap-2 px-2.5 pb-2 pl-9">
          <span class="text-muted">This folder no longer exists.</span>
          <Button onClick={onRemove}>Remove from list</Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

export function WelcomeScreen() {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [query, setQuery] = useState('');
  const [modules, setModules] = useState<ContributionSnapshot>(EMPTY_SNAPSHOT);

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

  const select = (page: Page) => {
    if (page === 'settings') window.saturn.windows.openSettings();
    if (page === 'marketplace') window.saturn.windows.openMarketplace();
  };

  const badgeFor = (p: RecentProject) => modules.languages.find((l) => l.id === p.languageId)?.badge ?? 'T';

  const open = async (p: RecentProject) => {
    if ((await window.saturn.projects.openPath(p.path)) === 'missing') load();
  };

  const q = query.trim().toLowerCase();
  const visible = projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));

  return (
    <div class="flex h-full" data-testid="screen-welcome">
      <SidebarNav<Page>
        header={<SaturnHeader />}
        items={[{ id: 'projects', label: 'Projects' }, { id: 'marketplace', label: 'Marketplace' }, { id: 'settings', label: 'Settings' }]}
        selected="projects"
        onSelect={select}
      />
      <main class="flex-1 flex flex-col p-3.5 min-w-0">
        <div class="flex gap-2 mb-3.5">
          <TextInput class="flex-1" value={query} onInput={setQuery} placeholder="Search projects" />
          <Button variant="primary" testId="welcome-new" onClick={() => window.saturn.windows.openNewProject()}>New</Button>
          <Button testId="welcome-open" onClick={() => void window.saturn.projects.openDialog()}>Open</Button>
          <Button disabled title="Coming soon">Clone</Button>
        </div>
        <div class="flex-1 overflow-y-auto">
          {visible.map((p) => (
            <ProjectRow
              key={p.path}
              project={p}
              badge={badgeFor(p)}
              onOpen={() => void open(p)}
              onRemove={() => void window.saturn.projects.removeRecent(p.path).then(load)}
            />
          ))}
          {projects.length === 0 && <p class="text-muted px-2.5">No recent projects yet. Create or open one to get started.</p>}
        </div>
      </main>
    </div>
  );
}
