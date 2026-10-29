export function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}
