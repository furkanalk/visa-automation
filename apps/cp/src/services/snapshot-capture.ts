import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import * as cheerio from 'cheerio';
import { getDb, WatcherRepository, PortalConfigRepository } from '@visa-automation/db';
import type { DiffSeverity } from '@visa-automation/shared';
import type { PortalSelectors } from '@visa-automation/shared';
import { sendTelegramToWatcher } from './telegram.js';

const FETCH_TIMEOUT_MS = 15000;
const JS_FETCH_TIMEOUT_MS = 8000;
const JS_MAX_SIZE_BYTES = 200_000; // 200 KB per script — skip larger files

/** Collect all CSS selector strings from portal selectors (recursive). */
function collectSelectorStrings(selectors: PortalSelectors | null | undefined): string[] {
  if (!selectors || typeof selectors !== 'object') return [];
  const out: string[] = [];
  function walk(obj: unknown): void {
    if (typeof obj === 'string' && obj.trim().length > 0) {
      out.push(obj.trim());
      return;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const v of Object.values(obj)) walk(v);
    }
  }
  walk(selectors);
  return [...new Set(out)];
}

/** Extract content under each selector from HTML and return hashes (selector -> hash). */
function selectorHashesFromHtml(html: string, selectorStrings: string[]): Record<string, string> {
  const $ = cheerio.load(html);
  const result: Record<string, string> = {};
  for (const sel of selectorStrings) {
    try {
      const el = $(sel).first();
      const content = (el.length ? el.html() ?? el.text() : '') || '';
      const normalized = content.replace(/\s+/g, ' ').trim();
      result[sel] = createHash('sha256').update(normalized).digest('hex');
    } catch {
      result[sel] = '';
    }
  }
  return result;
}

/**
 * Fetch HTML from a URL (simple GET). Returns empty string on failure.
 */
export async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VisaAutomation-Watcher/1.0' },
    });
    clearTimeout(timeout);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    clearTimeout(timeout);
    return '';
  }
}

function hashHtml(html: string): string {
  const normalized = html.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Extract same-origin <script src="..."> URLs from HTML and fetch their contents.
 * Only same-origin scripts are fetched to avoid pulling large CDN libraries.
 * Each script is capped at JS_MAX_SIZE_BYTES; failures are silently skipped.
 */
async function fetchSameOriginScripts(
  html: string,
  baseUrl: string,
  logger: FastifyBaseLogger,
): Promise<Array<{ url: string; content: string }>> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  const srcs: string[] = [];
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const abs = new URL(src, baseUrl).href;
      if (abs.startsWith(origin)) srcs.push(abs);
    } catch { /* invalid URL — skip */ }
  });

  if (srcs.length === 0) return [];

  const results = await Promise.allSettled(
    srcs.map(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), JS_FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'VisaAutomation-Watcher/1.0' },
        });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > JS_MAX_SIZE_BYTES) {
          logger.debug({ url, size: buf.byteLength }, 'Watcher: JS file too large, skipping');
          return null;
        }
        return { url, content: Buffer.from(buf).toString('utf8') };
      } catch {
        clearTimeout(timeout);
        return null;
      }
    }),
  );

  return results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((r): r is { url: string; content: string } => r !== null);
}

/**
 * Capture HTML from portal URL and create a snapshot. Skips if no URL or fetch fails.
 * Returns created snapshot id or null.
 * @param options.notifyTarget - Unused; HTML drift is always sent to Watcher chat when notify_on_change is true.
 */
export async function capturePortalSnapshot(
  logger: FastifyBaseLogger,
  tenantId: string,
  portalId: string,
  baseUrl: string,
  _options?: { notifyTarget?: 'watcher' | 'ops' }
): Promise<string | null> {
  const db = getDb();
  const watcherRepo = new WatcherRepository(db);
  const portalRepo = new PortalConfigRepository(db);

  const html = await fetchHtml(baseUrl);
  if (!html) {
    logger.warn({ portalId, baseUrl }, 'Snapshot capture: empty or failed fetch');
    return null;
  }

  const html_hash = hashHtml(html);

  // Fetch same-origin JS files alongside the HTML snapshot
  const js_scripts = await fetchSameOriginScripts(html, baseUrl, logger);
  logger.debug({ portalId, scriptCount: js_scripts.length }, 'Watcher: JS scripts captured');
  const previous = await watcherRepo.findLatestSnapshot(tenantId, portalId);
  const config = await watcherRepo.findConfigByTenantId(tenantId);
  const diff_mode = config?.diff_mode ?? 'hash';

  let diff_severity: DiffSeverity = 'none';
  let diff_summary: string | null = null;
  let previous_snapshot_id: string | null = null;

  if (previous) {
    previous_snapshot_id = previous.id;
    if (diff_mode === 'selector') {
      const portal = await portalRepo.findByPortalId(tenantId, portalId);
      const selectorStrings = collectSelectorStrings(portal?.selectors as PortalSelectors | undefined);
      // Only use selector-based diff when this portal has selectors configured
      if (selectorStrings.length > 0) {
        const prevHashes = selectorHashesFromHtml(previous.html ?? '', selectorStrings);
        const currHashes = selectorHashesFromHtml(html, selectorStrings);
        const changed = selectorStrings.some((sel) => prevHashes[sel] !== currHashes[sel]);
        if (changed) {
          diff_severity = 'medium';
          diff_summary = 'Selector content changed';
        }
      } else {
        if (previous.html_hash !== html_hash) {
          diff_severity = 'low';
          diff_summary = 'HTML content changed';
        }
      }
    } else {
      if (previous.html_hash !== html_hash) {
        diff_severity = 'low';
        diff_summary = 'HTML content changed';
      }
    }
  }

  const row = await watcherRepo.createSnapshot({
    tenant_id: tenantId,
    portal_id: portalId,
    captured_at: new Date(),
    html_hash,
    html,
    dom_digest: null,
    screenshot_path: null,
    diff_summary,
    diff_severity,
    previous_snapshot_id,
    metadata: { ...(js_scripts.length > 0 ? { js_scripts } : {}) },
    archived: false,
  });

  logger.info({ snapshotId: row.id, portalId, diff_severity }, 'Snapshot captured');

  if (diff_severity !== 'none') {
    const config = await watcherRepo.findConfigByTenantId(tenantId);
    if (config?.notify_on_change) {
      const msg =
        `📄 <b>Watcher – HTML drift</b>\n` +
        `Portal: <code>${portalId}</code>\n` +
        `Summary: ${diff_summary ?? 'Content changed'}\n` +
        `Snapshot: ${row.id}`;
      // HTML drift only to Watcher channel
      await sendTelegramToWatcher(tenantId, msg, logger);
    }
  }

  return row.id;
}
