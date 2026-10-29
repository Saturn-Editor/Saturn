import { execFile } from 'node:child_process';
import { cpus } from 'node:os';

export interface ProcessSample {
  cpu: number;
  memoryMb: number;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 3000, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

export function parsePs(out: string): ProcessSample | null {
  const [cpu, rssKb] = out.trim().split(/\s+/).map(Number);
  return Number.isFinite(cpu) && Number.isFinite(rssKb) ? { cpu, memoryMb: rssKb / 1024 } : null;
}

export function createSampler(pid: number, platform: NodeJS.Platform = process.platform): () => Promise<ProcessSample | null> {
  if (platform !== 'win32') {
    return () => run('ps', ['-o', '%cpu=,rss=', '-p', String(pid)]).then(parsePs, () => null);
  }
  let last: { cpuSeconds: number; at: number } | null = null;
  return async () => {
    const out = await run('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${pid}; "$($p.CPU) $($p.WorkingSet64)"`]).catch(() => '');
    const [cpuSeconds, bytes] = out.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(cpuSeconds) || !Number.isFinite(bytes)) return null;
    const now = Date.now();
    const cpu = last ? Math.max(0, ((cpuSeconds - last.cpuSeconds) / ((now - last.at) / 1000)) * 100 / cpus().length) : 0;
    last = { cpuSeconds, at: now };
    return { cpu, memoryMb: bytes / 1024 / 1024 };
  };
}
