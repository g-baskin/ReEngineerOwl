import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

export const CAPTURE_ANALYSIS_QUEUE = 'capture-analysis';

const connection = env.USE_REDIS_QUEUE ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) : null;

export const analysisQueue = connection
  ? new Queue(CAPTURE_ANALYSIS_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100
      }
    })
  : null;

export const enqueueCaptureAnalysis = async (captureId: string): Promise<void> => {
  if (!analysisQueue) {
    return;
  }
  await analysisQueue.add('analyze-capture', { captureId });
};
