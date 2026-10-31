export function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}

export { pluralName } from '@shared/modules';

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}
