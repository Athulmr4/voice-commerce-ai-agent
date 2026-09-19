// In-memory rolling latency stats (no Redis — spec says avoid it unless needed).
// Records server-side stages per turn; /api/voice/stats exposes aggregates.
export interface StageSample {
  llmMs: number;
  toolMs: number;
  totalMs: number;
  tool: string;
  intent: string;
  success: boolean;
}

const MAX_SAMPLES = 500;
const samples: StageSample[] = [];

export function recordTurn(s: StageSample): void {
  samples.push(s);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function summarize(values: number[]): { count: number; avgMs: number; p50Ms: number; p95Ms: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  return {
    count: sorted.length,
    avgMs: Math.round(avg * 10) / 10,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
  };
}

export function getLatencyStats(): {
  count: number;
  llm: ReturnType<typeof summarize>;
  tool: ReturnType<typeof summarize>;
  total: ReturnType<typeof summarize>;
  byTool: Record<string, number>;
  errors: number;
} {
  const byTool: Record<string, number> = {};
  for (const s of samples) byTool[s.tool] = (byTool[s.tool] ?? 0) + 1;
  return {
    count: samples.length,
    llm: summarize(samples.map(s => s.llmMs)),
    tool: summarize(samples.map(s => s.toolMs)),
    total: summarize(samples.map(s => s.totalMs)),
    byTool,
    errors: samples.filter(s => !s.success).length,
  };
}

/** Test helper: isolate stats between test files. */
export function resetLatencyStats(): void {
  samples.length = 0;
}
