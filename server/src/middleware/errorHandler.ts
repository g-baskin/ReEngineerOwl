import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('Unhandled error:', err);

  res.status(500).json({
    error: 'Internal server error',
    detail: env.NODE_ENV === 'development' && err instanceof Error ? err.message : undefined
  });
};
