import type { Kysely } from 'kysely';
import type { Database, JobScreenshotRow, NewJobScreenshot } from '../schema.js';

export class JobScreenshotRepository {
  constructor(private db: Kysely<Database>) {}

  async upsert(row: NewJobScreenshot): Promise<JobScreenshotRow> {
    const inserted = await this.db
      .insertInto('job_screenshots')
      .values({
        job_id: row.job_id,
        filename: row.filename,
        content_type: row.content_type ?? 'image/png',
        data: row.data,
      })
      .onConflict((oc) =>
        oc.columns(['job_id', 'filename']).doUpdateSet({
          content_type: row.content_type ?? 'image/png',
          data: row.data,
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted;
  }

  async getByJobAndFilename(
    jobId: string,
    filename: string
  ): Promise<JobScreenshotRow | undefined> {
    return this.db
      .selectFrom('job_screenshots')
      .selectAll()
      .where('job_id', '=', jobId)
      .where('filename', '=', filename)
      .executeTakeFirst();
  }
}
