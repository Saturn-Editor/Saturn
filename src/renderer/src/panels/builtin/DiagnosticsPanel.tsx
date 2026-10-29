import { useState } from 'preact/hooks';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

type Sample = { seconds: number; cpu: number; memoryMb: number };

const WIDTH = 300;
const HEIGHT = 80;

function Chart({ title, samples, value, format, testId }: { title: string; samples: Sample[]; value: (s: Sample) => number; format: (n: number) => string; testId: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = samples.map(value);
  const max = Math.max(1, ...values) * 1.1;
  const x = (i: number) => (samples.length < 2 ? WIDTH : (i / (samples.length - 1)) * WIDTH);
  const y = (v: number) => HEIGHT - (v / max) * HEIGHT;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const shown = hover !== null ? samples[hover] : samples[samples.length - 1];
  return (
    <figure class="m-0 flex flex-col gap-1 min-w-0" data-testid={testId}>
      <figcaption class="flex items-baseline justify-between">
        <span class="text-muted">{title}</span>
        <span class="text-strong font-semibold tabular-nums">{shown ? format(value(shown)) : '–'}{hover !== null && shown ? <span class="text-muted font-normal"> at {shown.seconds}s</span> : null}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        class="w-full h-20 bg-editor border border-divider"
        role="img"
        aria-label={`${title} over the last ${samples.length} seconds`}
        onPointerMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - box.left) / box.width) * (samples.length - 1));
          setHover(samples.length ? Math.max(0, Math.min(samples.length - 1, i)) : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1="0" x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} stroke="var(--saturn-divider)" stroke-width="1" vector-effect="non-scaling-stroke" />
        {samples.length > 1 && <polyline points={points} fill="none" stroke="var(--saturn-accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2={HEIGHT} stroke="var(--saturn-muted)" stroke-width="1" vector-effect="non-scaling-stroke" />
        )}
      </svg>
    </figure>
  );
}

export function DiagnosticsPanel() {
  const { debug } = useWorkspace();
  const s = debug.state.value;
  const metrics = s.metrics;
  if (!metrics) {
    return (
      <p class="m-0 p-3 text-muted" data-testid="debug-diagnostics">
        {s.state === 'idle' ? 'CPU and memory graphs show here while you debug.' : "This debugger hasn't reported the program's process, so its CPU and memory can't be shown."}
      </p>
    );
  }
  return (
    <div class="h-full overflow-y-auto p-3 flex flex-col gap-3" data-testid="debug-diagnostics">
      <div class="text-muted">Process {metrics.pid} · one sample per second</div>
      <Chart title="CPU" samples={metrics.samples} value={(m) => m.cpu} format={(n) => `${n.toFixed(0)}%`} testId="diagnostics-cpu" />
      <Chart title="Memory" samples={metrics.samples} value={(m) => m.memoryMb} format={(n) => `${n.toFixed(0)} MB`} testId="diagnostics-memory" />
    </div>
  );
}
