import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

export type AuthenticatedUser = {
  id: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const requireBearerToken = (authorization?: string): string | null => {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }
  return authorization.slice('Bearer '.length).trim();
};

export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (env.AUTH_MODE === 'dev') {
    const email = req.header('X-User-Email')?.trim().toLowerCase();
    if (!email) {
      res.status(401).json({ error: 'X-User-Email header required in dev auth mode' });
      return;
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email }
    });

    req.user = { id: user.id, email: user.email };
    next();
    return;
  }

  const token = requireBearerToken(req.header('Authorization'));
  if (!token) {
    res.status(401).json({ error: 'Bearer token required' });
    return;
  }

  if (token.length < 10) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.user = {
    id: 'jwt-user-placeholder',
    email: 'jwt-user@example.com'
  };

  next();
};
