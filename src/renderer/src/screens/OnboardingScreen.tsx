import { useEffect, useState } from 'preact/hooks';
import { chooseVersion, type MarketplaceEntry } from '@shared/marketplace';
import type { ModuleKind } from '@shared/modules';
import { Button, Checkbox, DialogFooter, Heading, Logo, ModuleIcon } from '@renderer/components';
import { isUpToDate, MarketplaceEntries, useInstalledModules, useMarketplaceList } from '@renderer/screens/MarketplaceIndex';
import { ModeToggle } from '@renderer/theme/ModeToggle';
import { errorText } from '@renderer/helpers';


function ModulePicker({ kind, entries, selected, onToggle }: { kind: ModuleKind; entries: MarketplaceEntry[]; selected: Set<string>; onToggle: (id: string, on: boolean) => void }) {
  return (
    <div class="flex flex-col">
      {entries.map((l) => (
        <div key={l.id} class="flex items-center gap-3 py-1.5 border-b border-divider" data-testid={`onboarding-${kind}`}>
          <Checkbox checked={selected.has(l.id)} onChange={(on) => onToggle(l.id, on)} testId={`onboarding-${kind}-${l.id}`} />
          <ModuleIcon icon={l.image} badge={l.name.slice(0, 2).toUpperCase()} class="size-6" />
          <div class="flex-1 min-w-0">
            <div class="text-strong truncate">{l.name}</div>
            <div class="text-muted truncate">{l.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const offered = (l: MarketplaceEntry) => !!l.default && !!chooseVersion(l).installable;
const installable = (entries: MarketplaceEntry[]) => entries.filter(offered);

function useChoices(kind: ModuleKind) {
  const [list, reload] = useMarketplaceList(kind === 'language' ? 'languages' : 'extensions');
  const installed = useInstalledModules(kind);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (list?.status === 'loaded') setSelected(new Set(installable(list.entries).map((l) => l.id)));
  }, [list]);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const chosen = () => (list?.status === 'loaded' ? installable(list.entries).filter((l) => selected.has(l.id) && !isUpToDate(installed, l)) : []);
  return { kind, list, reload, installed, selected, toggle, chosen };
}

function ModuleSection({ title, noun, choices }: { title: string; noun: string; choices: ReturnType<typeof useChoices> }) {
  return (
    <section>
      <Heading>{title}</Heading>
      <MarketplaceEntries
        state={choices.list}
        filter={offered}
        hide={(l) => isUpToDate(choices.installed, l)}
        allHidden={`All available ${noun} are already installed.`}
        onRetry={choices.reload}
      >
        {(entries) => <ModulePicker kind={choices.kind} entries={entries} selected={choices.selected} onToggle={choices.toggle} />}
      </MarketplaceEntries>
    </section>
  );
}

export function OnboardingScreen() {
  const languages = useChoices('language');
  const extensions = useChoices('extension');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    const queue = [
      ...languages.chosen().map((e) => ({ e, install: window.saturn.marketplace.installLanguage })),
      ...extensions.chosen().map((e) => ({ e, install: window.saturn.marketplace.installExtension })),
    ];
    const failed: string[] = [];
    setError(null);
    for (const { e, install } of queue) {
      setProgress(`Installing ${e.name}…`);
      try {
        await install(e.id);
      } catch (err) {
        failed.push(`${e.name}: ${errorText(err)}`);
      }
    }
    setProgress(null);
    if (failed.length > 0) setError(`Couldn't install ${failed.join('; ')}. You can try again from the Marketplace.`);
    else window.saturn.window.close();
  };

  return (
    <div class="flex flex-col h-full" data-testid="screen-onboarding">
      <div class="flex-1 overflow-y-auto px-8 pt-8 pb-4 flex flex-col gap-6">
        <div class="flex flex-col items-center gap-3">
          <Logo class="h-20" />
          <h1 class="m-0 text-lg font-semibold text-strong">Welcome to Saturn</h1>
        </div>
        <section>
          <Heading>Theme</Heading>
          <ModeToggle />
          <p class="mt-1.5 mb-0 text-muted text-[11px]">More themes are available in the Saturn Marketplace.</p>
        </section>
        <ModuleSection title="Languages" noun="languages" choices={languages} />
        <ModuleSection title="Extensions" noun="extensions" choices={extensions} />
        {error && <p class="m-0 text-accent" role="alert">{error}</p>}
        <p class="m-0 text-muted text-[11px]">More languages and extensions can be installed from the Saturn Marketplace.</p>
      </div>
      <DialogFooter>
        {progress && <span class="mr-auto self-center text-muted">{progress}</span>}
        <Button variant="primary" testId="onboarding-finish" disabled={progress !== null} onClick={() => (error ? window.saturn.window.close() : void finish())}>
          {error ? 'Continue' : 'Get started'}
        </Button>
      </DialogFooter>
    </div>
  );
}
