import express, { type Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { capturesRouter } from './routes/captures.js';
import { exportsRouter } from './routes/exports.js';
import { orgsRouter } from './routes/orgs.js';
import { projectsRouter } from './routes/projects.js';
import { startWorkers } from './services/jobs/workers.js';

const logger = pino({ level: env.LOG_LEVEL });
const app = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: any) {
        return {
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress
        };
      }
    }
  })
);

app.use(
  cors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || env.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  })
);

app.use(helmet());
app.use(express.json({ limit: env.maxUploadSizeBytes }));
app.use(express.urlencoded({ extended: false, limit: env.maxUploadSizeBytes }));

app.get('/health', (_req: Request, res) => {
  res.json({ ok: true, authMode: env.AUTH_MODE, useMinio: env.USE_MINIO, useRedisQueue: env.USE_REDIS_QUEUE });
});

app.use('/exports', exportsRouter);

app.use(authMiddleware);
app.use('/orgs', orgsRouter);
app.use('/orgs/:orgId/projects', projectsRouter);
app.use('/orgs/:orgId/projects/:projectId/captures', capturesRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const start = async (): Promise<void> => {
  try {
    await prisma.$connect();
    startWorkers();
    app.listen(env.PORT, () => {
      logger.info(`Server listening on port ${env.PORT}`);
    });
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
};

void start();
