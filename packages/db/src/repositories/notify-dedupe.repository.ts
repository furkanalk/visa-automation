import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * DB-backed dedupe for notifications. One row per (job_id, type, semantic_key).
 * tryRecordSend: returns true if we "won" the right to send (first insert); false if already sent.
 */
export class NotifyDedupeRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * Try to record a send. Returns true if this is the first send for (job_id, type, semantic_key);
   * false if already sent (duplicate). Call before sending; only send if true.
   */
  async tryRecordSend(jobId: string, type: string, semanticKey: string = ''): Promise<boolean> {
    const row = await this.db
      .insertInto('notify_dedupe')
      .values({
        job_id: jobId,
        type,
        semantic_key: semanticKey,
      })
      .onConflict((oc) =>
        oc.columns(['job_id', 'type', 'semantic_key']).doNothing()
      )
      .returning('id')
      .executeTakeFirst();
    return row != null;
  }
}
