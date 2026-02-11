import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../config/env.js';
import { CAPTURE_ANALYSIS_QUEUE } from './queue.js';

let worker: Worker | null = null;

export const startWorkers = (): void => {
  if (!env.USE_REDIS_QUEUE || worker) {
    return;
  }

  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  worker = new Worker(
    CAPTURE_ANALYSIS_QUEUE,
    async (job) => {
      console.log(`Received capture analysis job ${job.id} for capture ${job.data.captureId}`);
      // Stub: actual processing can be delegated here.
    },
    { connection }
  );

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed`, error);
  });
};
