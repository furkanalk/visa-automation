import type { DeepPartial } from './types.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, ...overrides: Array<DeepPartial<T> | undefined>): T {
  let out: any = structuredClone(base);

  for (const ov of overrides) {
    if (!ov) continue;
    out = mergeTwo(out, ov);
  }

  return out as T;
}

function mergeTwo<T>(a: T, b: DeepPartial<T>): T {
  const out: any = Array.isArray(a) ? [...(a as any)] : { ...(a as any) };

  for (const [k, bv] of Object.entries(b as any)) {
    const av = (a as any)[k];

    if (Array.isArray(bv)) {
      // arrays override completely
      out[k] = bv;
      continue;
    }

    if (isObject(av) && isObject(bv)) {
      out[k] = mergeTwo(av, bv);
      continue;
    }

    out[k] = bv;
  }

  return out as T;
}
