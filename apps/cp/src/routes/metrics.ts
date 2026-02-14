import type { FastifyPluginAsync } from 'fastify';
import { getQueue } from '../queue/producer.js';

/**
 * Prometheus text exposition format.
 * Single gauge: cp_queue_depth (waiting + active + delayed).
 */
function formatPrometheus(name: string, value: number, type: string): string {
  return `# TYPE ${name} ${type}\n${name} ${value}\n`;
}

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /cp/metrics
   * Returns Prometheus text format with queue depth.
   */
  app.get('/', async (_request, reply) => {
    let queueDepth = 0;
    try {
      const queue = await getQueue();
      const counts = await queue.getJobCounts();
      queueDepth = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    } catch {
      queueDepth = -1;
    }

    const body =
      formatPrometheus('cp_queue_depth', queueDepth, 'gauge');

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return body;
  });
};
