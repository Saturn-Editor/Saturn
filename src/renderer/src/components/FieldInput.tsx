import type { NewProjectField, SettingValue } from '@shared/modules';
import { Button } from './Button';
import { Checkbox, Select, TextInput } from './inputs';

interface FieldInputProps {
  field: NewProjectField;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  /** Called once a change is final: straight away for checkboxes, selects and Browse…, on blur for typed text. */
  onCommit?: (value: SettingValue) => void;
}

/** One module-supplied field (New Project form or module setting), drawn with Saturn's own components. */
export function FieldInput({ field, value, onChange, onCommit }: FieldInputProps) {
  const now = (v: SettingValue) => {
    onChange(v);
    onCommit?.(v);
  };
  if (field.type === 'checkbox') return <Checkbox checked={value === true} onChange={now} />;
  if (field.type === 'select') return <Select value={String(value)} options={field.options ?? []} onChange={now} />;
  const text = <TextInput class="flex-1" value={String(value)} onInput={onChange} onBlur={() => onCommit?.(value)} />;
  if (field.type === 'folder' || field.type === 'file') {
    const pick = field.type === 'file' ? window.saturn.projects.pickFile : window.saturn.projects.pickFolder;
    return (
      <div class="flex gap-2">
        {text}
        <Button onClick={() => void pick().then((p) => p && now(p))}>Browse…</Button>
      </div>
    );
  }
  return text;
}
