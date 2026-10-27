import {Button, Heading} from '@renderer/components';
import {ButtonHTMLAttributes} from "preact/compat";

export function HelpPage() {
  return (
    <main class="flex-1 overflow-y-auto min-w-0" data-testid="welcome-about">
      <div class="max-w-xl mx-auto px-6 py-8 flex flex-col gap-7">
        <section>
          <Heading>Report a problem or request a feature</Heading>
          <Button variant="primary" onClick={() => window.open('https://github.com/saturn-editor/saturn/issues')}>Saturn Core</Button>&nbsp;
          <Button variant="primary" onClick={() => window.open('https://github.com/saturn-editor/marketplace/issues')}>Marketplace</Button>&nbsp;
          <Button variant="primary" onClick={() => window.open('https://github.com/orgs/saturn-editor/repositories')}>Languages, Extensions, and Themes</Button>
        </section>
        <section>
          <Heading>Help guides</Heading>
          <Button variant="primary" onClick={() => window.open('https://saturn-editor.gitbook.io/w/user-guide')}>User guide</Button>&nbsp;
          <Button variant="primary" onClick={() => window.open('https://saturn-editor.gitbook.io/w/developer-guide')}>Developer guide</Button>
        </section>
      </div>
    </main>
  );
}
