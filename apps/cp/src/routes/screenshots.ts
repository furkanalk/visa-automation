import type { FastifyPluginAsync } from 'fastify';
import { getDb, JobScreenshotRepository, JobRepository } from '@visa-automation/db';

interface ScreenshotParams {
  jobId: string;
  filename: string;
}

interface UploadBody {
  job_id: string;
  filename: string;
  data: string; // base64
}

export const screenshotRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const screenshotRepo = new JobScreenshotRepository(db);
  const jobRepo = new JobRepository(db);

  /**
   * Upload screenshot (DP only). Requires X-Internal-Secret.
   * POST /cp/screenshots
   */
  app.post<{ Body: UploadBody }>('/', async (request, reply) => {
    const secret = request.headers['x-internal-secret'] as string | undefined;
    const expected = process.env.CP_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Internal-Secret' },
      });
    }
    const { job_id, filename, data: base64 } = request.body ?? {};
    if (!job_id || !filename || !base64) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'job_id, filename, and data (base64) required' },
      });
    }
    const job = await jobRepo.findByIdAndTenant(job_id, request.tenantId);
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid base64 data' },
      });
    }
    await screenshotRepo.upsert({
      job_id,
      filename,
      content_type: 'image/png',
      data: buffer,
    });
    return { success: true, data: { job_id, filename } };
  });

  /**
   * Get screenshot image. Job must belong to request tenant.
   * GET /cp/screenshots/:jobId/:filename
   */
  app.get<{ Params: ScreenshotParams }>('/:jobId/:filename', async (request, reply) => {
    const { jobId, filename } = request.params;
    const job = await jobRepo.findByIdAndTenant(jobId, request.tenantId);
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job or screenshot not found' },
      });
    }
    const row = await screenshotRepo.getByJobAndFilename(jobId, filename);
    if (!row) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Screenshot not found' },
      });
    }
    return reply
      .header('Content-Type', row.content_type)
      .send(row.data);
  });
};
