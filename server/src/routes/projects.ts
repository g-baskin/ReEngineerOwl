import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional()
});

export const projectsRouter = Router({ mergeParams: true });

const requireOrgMember = async (orgId: string, userId: string): Promise<boolean> => {
  const membership = await prisma.orgMember.findUnique({
    where: {
      orgId_userId: {
        orgId,
        userId
      }
    }
  });

  return Boolean(membership);
};

projectsRouter.post('/', async (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const orgId = req.params.orgId;
  if (!orgId || !(await requireOrgMember(orgId, user.id))) {
    res.status(403).json({ error: 'Forbidden for this organization' });
    return;
  }

  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const project = await prisma.project.create({
    data: {
      orgId,
      name: parsed.data.name,
      description: parsed.data.description
    }
  });

  res.status(201).json(project);
});

projectsRouter.get('/', async (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const orgId = req.params.orgId;
  if (!orgId || !(await requireOrgMember(orgId, user.id))) {
    res.status(403).json({ error: 'Forbidden for this organization' });
    return;
  }

  const projects = await prisma.project.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' }
  });

  res.json(projects);
});
