import { useState } from 'preact/hooks';
import { Button, Checkbox, TextInput } from '@renderer/components';
import { errorText } from '@renderer/helpers';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

function Remember({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label class="flex items-center gap-2">
      <Checkbox checked={on} onChange={() => onChange(!on)} testId="notebook-remember" />
      <span>Remember on this device</span>
    </label>
  );
}

export function UnlockNotebook() {
  const ws = useWorkspace();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      await window.saturn.notebooks.unlock(password, remember);
      ws.notebookLock.value = await window.saturn.notebooks.lockState();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  return (
    <div class="h-full flex items-center justify-center bg-editor" data-testid="notebook-locked">
      <div class="w-[360px] flex flex-col gap-3">
        <div class="font-semibold text-strong">This notebook is locked</div>
        <TextInput secret autoFocus value={password} onInput={setPassword} placeholder="Password" testId="notebook-password" onKeyDown={(e) => e.key === 'Enter' && void unlock()} />
        <Remember on={remember} onChange={setRemember} />
        {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
        <div class="flex justify-end">
          <Button variant="primary" disabled={!password || busy} testId="notebook-unlock" onClick={() => void unlock()}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
        </div>
      </div>
    </div>
  );
}

const TITLES = { encrypt: 'Encrypt notebook', password: 'Change notebook password', decrypt: 'Remove notebook encryption' } as const;

export function EncryptionDialog() {
  const ws = useWorkspace();
  const mode = ws.encryptionDialog.value;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!mode) return null;

  const lock = ws.notebookLock.value;
  const unavailable = mode === 'encrypt' ? (lock !== 'none' ? 'This notebook is already encrypted.' : null)
    : lock === 'none' ? "This notebook isn't encrypted."
      : lock === 'locked' && mode === 'password' ? 'Unlock the notebook first.' : null;

  const close = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setProblem(null);
    ws.encryptionDialog.value = null;
  };

  const submit = async () => {
    if (busy || unavailable) return;
    if (mode !== 'decrypt' && next !== confirm) return setProblem("The passwords don't match");
    if (mode !== 'encrypt' && !current) return setProblem('Enter the current password');
    setBusy(true);
    setProblem(null);
    try {
      await Promise.all([...ws.pageSavers].map((save) => save()));
      if (mode === 'encrypt') await window.saturn.notebooks.encrypt(next, remember);
      else if (mode === 'password') await window.saturn.notebooks.changePassword(current, next);
      else await window.saturn.notebooks.decrypt(current);
      ws.notebookLock.value = await window.saturn.notebooks.lockState();
      close();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const enter = (e: KeyboardEvent) => e.key === 'Enter' && void submit();

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="notebook-encryption" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div class="w-[440px] p-4 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-3">
        <div class="font-semibold text-strong">{TITLES[mode]}</div>
        {unavailable ? <p class="m-0">{unavailable}</p> : (
          <>
            {mode === 'encrypt' && (
              <p class="m-0 text-muted">
                Your pages will be encrypted with your password. If you forget it the notebook can't be recovered. If your notebook is hosted in git, previous unencrypted copies in the history aren't protected.
              </p>
            )}
            {mode === 'decrypt' && <p class="m-0 text-muted">Every page will be saved unencrypted, and the password will be removed.</p>}
            {mode !== 'encrypt' && <TextInput secret autoFocus value={current} onInput={setCurrent} placeholder="Current password" testId="notebook-current-password" onKeyDown={enter} />}
            {mode !== 'decrypt' && (
              <>
                <TextInput secret autoFocus={mode === 'encrypt'} value={next} onInput={setNext} placeholder="New password (8 or more characters)" testId="notebook-new-password" onKeyDown={enter} />
                <TextInput secret value={confirm} onInput={setConfirm} placeholder="Confirm password" testId="notebook-confirm-password" onKeyDown={enter} />
              </>
            )}
            {mode === 'encrypt' && <Remember on={remember} onChange={setRemember} />}
          </>
        )}
        {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
        <div class="flex justify-end gap-2">
          <Button onClick={close}>{unavailable ? 'Close' : 'Cancel'}</Button>
          {!unavailable && (
            <Button variant="primary" disabled={busy} testId="notebook-encryption-ok" onClick={() => void submit()}>
              {busy ? 'Working…' : mode === 'encrypt' ? 'Encrypt' : mode === 'password' ? 'Change password' : 'Remove encryption'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
