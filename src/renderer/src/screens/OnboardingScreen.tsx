import { useEffect, useState } from 'preact/hooks';
import { chooseVersion, type MarketplaceEntry } from '@shared/marketplace';
import { Button, Checkbox, DialogFooter, Heading, Logo, ModuleIcon } from '@renderer/components';
import { isUpToDate, MarketplaceEntries, useInstalledModules, useMarketplaceList } from '@renderer/screens/MarketplaceIndex';
import { ModeToggle } from '@renderer/theme/ModeToggle';

function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}

function LanguagePicker({ entries, selected, onToggle }: { entries: MarketplaceEntry[]; selected: Set<string>; onToggle: (id: string, on: boolean) => void }) {
  return (
    <div class="flex flex-col">
      {entries.map((l) => (
        <div key={l.id} class="flex items-center gap-3 py-1.5 border-b border-divider" data-testid="onboarding-language">
          <Checkbox checked={selected.has(l.id)} onChange={(on) => onToggle(l.id, on)} testId={`onboarding-language-${l.id}`} />
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

/** First-launch popup: pick Light or Dark and which marketplace languages to install. */
export function OnboardingScreen() {
  const [list, reloadList] = useMarketplaceList('languages');
  const installed = useInstalledModules();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only languages with a version this Saturn can install are offered.
  const installable = (entries: MarketplaceEntry[]) => entries.filter((l) => chooseVersion(l).installable);
  // Languages marked `default` in the marketplace start ticked.
  useEffect(() => {
    if (list?.status === 'loaded') setSelected(new Set(installable(list.entries).filter((l) => l.default).map((l) => l.id)));
  }, [list]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const finish = async () => {
    const chosen = list?.status === 'loaded'
      ? installable(list.entries).filter((l) => selected.has(l.id) && !isUpToDate(installed, l))
      : [];
    const failed: string[] = [];
    setError(null);
    for (const l of chosen) {
      setProgress(`Installing ${l.name}…`);
      try {
        await window.saturn.marketplace.installLanguage(l.id);
      } catch (e) {
        failed.push(`${l.name}: ${errorText(e)}`);
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
        <section>
          <Heading>Languages</Heading>
          <MarketplaceEntries
            state={list}
            filter={(l) => !!chooseVersion(l).installable}
            hide={(l) => isUpToDate(installed, l)}
            allHidden="All available languages are already installed."
            onRetry={reloadList}
          >
            {(entries) => <LanguagePicker entries={entries} selected={selected} onToggle={toggle} />}
          </MarketplaceEntries>
        </section>
        {error && <p class="m-0 text-accent" role="alert">{error}</p>}
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
