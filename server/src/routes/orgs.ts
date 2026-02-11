import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';

const createOrgSchema = z.object({
  name: z.string().min(1).max(120)
});

export const orgsRouter = Router();

orgsRouter.post('/', async (req, res) => {
  const parsed = createOrgSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const org = await prisma.org.create({
    data: {
      name: parsed.data.name,
      members: {
        create: {
          userId: user.id,
          role: 'owner'
        }
      }
    }
  });

  res.status(201).json(org);
});

orgsRouter.get('/', async (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const memberships = await prisma.orgMember.findMany({
    where: { userId: user.id },
    include: { org: true }
  });

  res.json(
    memberships.map((member) => ({
      role: member.role,
      org: member.org
    }))
  );
});
