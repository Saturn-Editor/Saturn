import { useEffect, useState } from 'preact/hooks';
import { Button, TextInput } from '@renderer/components';

interface Prompt {
  id: string;
  text: string;
  secret: boolean;
}

/**
 * Git asking for a username, password, token or SSH passphrase (e.g. on push, pull or clone), shown
 * over whatever this window shows. Cancelling makes the Git command fail with Git's own message.
 */
export function CredentialPrompt() {
  const [queue, setQueue] = useState<Prompt[]>([]);
  const [value, setValue] = useState('');
  useEffect(() => window.saturn.git.onCredentialPrompt((id, text, secret) => setQueue((q) => [...q, { id, text, secret }])), []);
  const prompt = queue[0];
  if (!prompt) return null;

  const answer = (reply: string | null) => {
    void window.saturn.git.answerCredential(prompt.id, reply);
    setValue('');
    setQueue((q) => q.slice(1));
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="credential-prompt">
      <div
        class="w-96 p-4 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-3"
        onKeyDown={(e) => {
          if (e.key === 'Enter') answer(value);
          if (e.key === 'Escape') answer(null);
        }}
      >
        <div class="font-semibold text-strong">Git needs to sign in</div>
        <p class="m-0 break-words">{prompt.text.replace(/:\s*$/, '')}</p>
        <TextInput key={prompt.id} value={value} onInput={setValue} secret={prompt.secret} testId="credential-value" autoFocus />
        <p class="m-0 text-muted text-[11px]">For GitHub, use a personal access token as the password. Git's credential helper can remember it.</p>
        <div class="flex justify-end gap-2">
          <Button onClick={() => answer(null)}>Cancel</Button>
          <Button variant="primary" testId="credential-submit" onClick={() => answer(value)}>Continue</Button>
        </div>
      </div>
    </div>
  );
}
