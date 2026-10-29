import { signal } from '@preact/signals';
import type { SaturnApi } from '@shared/api';
import type { TestGroup, TestItem, TestResult } from '@shared/modules';

export interface TestLocation {
  controllerId: string;
  item: TestItem;
}

export class TestsController {
  readonly groups = signal<TestGroup[]>([]);
  readonly results = signal<Map<string, TestResult>>(new Map());
  readonly output = signal('');
  readonly running = signal(false);
  readonly loading = signal(false);
  readonly coverage = signal<Map<string, { covered: Set<number>; uncovered: Set<number> }>>(new Map());
  readonly showCoverage = signal(true);
  private runs = new Set<string>();

  constructor(private readonly api: SaturnApi) {
    api.tests.onEvent((event) => {
      if (!this.runs.has(event.runId)) return;
      if (event.kind === 'result') {
        if (event.result.label) this.addFound(event.controllerId, event.result);
        this.results.value = new Map(this.results.value).set(`${event.controllerId}:${event.result.id}`, event.result);
      }
      if (event.kind === 'output') this.output.value += event.text;
      if (event.kind === 'coverage') {
        const next = new Map(this.coverage.value);
        for (const file of event.files) {
          const current = next.get(file.path) ?? { covered: new Set<number>(), uncovered: new Set<number>() };
          for (const line of file.covered) {
            current.covered.add(line);
            current.uncovered.delete(line);
          }
          for (const line of file.uncovered) if (!current.covered.has(line)) current.uncovered.add(line);
          next.set(file.path, current);
        }
        this.coverage.value = next;
        this.showCoverage.value = true;
      }
      if (event.kind === 'done') {
        this.runs.delete(event.runId);
        if (event.error) this.output.value += `\n${event.error}\n`;
        this.running.value = this.runs.size > 0;
      }
    });
  }

  async discover(): Promise<void> {
    this.loading.value = true;
    try {
      this.groups.value = await this.api.tests.discover();
    } finally {
      this.loading.value = false;
    }
  }

  result(controllerId: string, id: string): TestResult | undefined {
    return this.results.value.get(`${controllerId}:${id}`);
  }

  coverageSummary(): { covered: number; total: number } | null {
    if (!this.coverage.value.size) return null;
    let covered = 0;
    let total = 0;
    for (const file of this.coverage.value.values()) {
      covered += file.covered.size;
      total += file.covered.size + file.uncovered.size;
    }
    return { covered, total };
  }

  async runAllWithCoverage(): Promise<void> {
    this.output.value = '';
    this.coverage.value = new Map();
    await Promise.all(this.groups.value.filter((g) => g.canCover).map((g) => this.run(g.controllerId, null, true)));
  }

  async run(controllerId: string, ids: string[] | null, coverage = false): Promise<void> {
    const runId = crypto.randomUUID();
    this.runs.add(runId);
    this.running.value = true;
    const next = new Map(this.results.value);
    const group = this.groups.value.find((g) => g.controllerId === controllerId);
    for (const item of leaves(group?.items ?? [])) if (!ids || ids.includes(item.id)) next.delete(`${controllerId}:${item.id}`);
    this.results.value = next;
    try {
      await this.api.tests.run(controllerId, ids, runId, coverage);
    } catch (e) {
      this.runs.delete(runId);
      this.running.value = this.runs.size > 0;
      throw e;
    }
  }

  async runAll(): Promise<void> {
    this.output.value = '';
    await Promise.all(this.groups.value.map((g) => this.run(g.controllerId, null)));
  }

  async runFailed(): Promise<void> {
    this.output.value = '';
    for (const g of this.groups.value) {
      const failed = leaves(g.items).filter((i) => this.result(g.controllerId, i.id)?.state === 'failed').map((i) => i.id);
      if (failed.length) await this.run(g.controllerId, failed);
    }
  }

  debug(controllerId: string, ids: string[] | null): Promise<void> {
    return this.api.tests.debug(controllerId, ids);
  }

  async stop(): Promise<void> {
    const runs = [...this.runs];
    await Promise.all(runs.map((runId) => this.api.tests.cancel(runId).catch(() => undefined)));
    const next = new Map(this.results.value);
    for (const [key, result] of next) if (result.state === 'running') next.set(key, { ...result, state: 'skipped', message: 'Stopped' });
    this.results.value = next;
  }

  private addFound(controllerId: string, result: TestResult): void {
    const groups = this.groups.value;
    const group = groups.find((g) => g.controllerId === controllerId);
    if (!group || all(group.items).some((i) => i.id === result.id)) return;
    const item: TestItem = { id: result.id, label: result.label!, path: result.path, line: result.line };
    const insert = (items: TestItem[]): [TestItem[], boolean] => {
      let placed = false;
      const next = items.map((i) => {
        if (placed) return i;
        if (i.id === result.parentId) {
          placed = true;
          return { ...i, children: [...(i.children ?? []), item] };
        }
        const [children, inside] = insert(i.children ?? []);
        if (inside) placed = true;
        return inside ? { ...i, children } : i;
      });
      return [next, placed];
    };
    const [items, placed] = result.parentId ? insert(group.items) : [group.items, false];
    this.groups.value = groups.map((g) => (g === group ? { ...g, items: placed ? items : [...group.items, item] } : g));
  }

  testsIn(path: string): TestLocation[] {
    return this.groups.value.flatMap((g) => all(g.items).filter((i) => i.path === path && i.line).map((item) => ({ controllerId: g.controllerId, item })));
  }
}

function all(items: TestItem[]): TestItem[] {
  return items.flatMap((i) => [i, ...all(i.children ?? [])]);
}

export function leaves(items: TestItem[]): TestItem[] {
  return items.flatMap((i) => (i.children?.length ? leaves(i.children) : [i]));
}
