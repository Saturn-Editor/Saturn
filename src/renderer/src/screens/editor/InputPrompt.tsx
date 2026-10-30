import { useEffect, useState } from 'preact/hooks';
import { Button, TextInput } from '@renderer/components';
import { useWorkspace } from './EditorWorkspace';

export function InputPrompt() {
  const ws = useWorkspace();
  const prompt = ws.inputPrompt.value;
  const [value, setValue] = useState('');
  useEffect(() => setValue(prompt?.options.value ?? ''), [prompt]);
  if (!prompt) return null;

  const finish = (result: string | null) => {
    ws.inputPrompt.value = null;
    prompt.resolve(result);
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="input-prompt">
      <div class="w-[400px] p-4 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-3">
        <div class="font-semibold text-strong">{prompt.options.title}</div>
        <TextInput
          value={value}
          onInput={setValue}
          placeholder={prompt.options.placeholder}
          autoFocus
          testId="input-prompt-value"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) finish(value.trim());
            if (e.key === 'Escape') finish(null);
          }}
        />
        <div class="flex justify-end gap-2">
          <Button onClick={() => finish(null)}>Cancel</Button>
          <Button variant="primary" testId="input-prompt-ok" onClick={() => value.trim() && finish(value.trim())}>OK</Button>
        </div>
      </div>
    </div>
  );
}
