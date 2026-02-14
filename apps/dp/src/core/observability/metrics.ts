/**
 * Simple in-memory metrics for Prometheus exposition.
 * Counters and gauges only; no histograms.
 */

type LabelMap = Record<string, string> | undefined;

function labelsKey(labels?: LabelMap): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

const counterEntries = new Map<string, { name: string; labels?: LabelMap; value: number }>();
const gaugeEntries = new Map<string, { name: string; labels?: LabelMap; value: number }>();

function counterKey(name: string, labels?: LabelMap): string {
  return `${name}|${labelsKey(labels)}`;
}

export const metrics = {
  counter(name: string, labels?: LabelMap): { inc(n?: number): void } {
    const k = counterKey(name, labels);
    return {
      inc(n = 1) {
        const cur = counterEntries.get(k);
        if (cur) cur.value += n;
        else counterEntries.set(k, { name, labels, value: n });
      },
    };
  },

  gauge(name: string, labels?: LabelMap): { set(value: number): void } {
    const k = counterKey(name, labels); // reuse key format
    return {
      set(value: number) {
        gaugeEntries.set(k, { name, labels, value });
      },
    };
  },

  getCounters(): Array<{ name: string; labels?: LabelMap; value: number }> {
    return Array.from(counterEntries.values());
  },

  getGauges(): Array<{ name: string; labels?: LabelMap; value: number }> {
    return Array.from(gaugeEntries.values());
  },

  /** Prometheus exposition format (text) */
  prometheusText(): string {
    const lines: string[] = [];
    const formatLabels = (l?: LabelMap) =>
      l && Object.keys(l).length
        ? `{${Object.entries(l)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
            .join(',')}}`
        : '';

    for (const { name, labels, value } of this.getCounters()) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
    for (const { name, labels, value } of this.getGauges()) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
    return lines.length ? lines.join('\n') + '\n' : '# No metrics\n';
  },
};
