import crypto from 'node:crypto';
import { CaptureStatus } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import mime from 'mime-types';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { analyzeArchitecture, type NormalizedEntry } from '../services/analysis/architectureAnalyzer.js';
import { enqueueCaptureAnalysis } from '../services/jobs/queue.js';
import { getStorageAdapter } from '../services/storage/index.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadSizeBytes }
});

const createCaptureSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  stats: z.string().optional()
});

const ARTIFACT_MAP = {
  bundle: 'bundleStorageKey',
  schema: 'schemaStorageKey',
  openapi: 'openapiStorageKey',
  postman: 'postmanStorageKey',
  arch: 'architectureStorageKey'
} as const;

type ArtifactName = keyof typeof ARTIFACT_MAP;

export const capturesRouter = Router({ mergeParams: true });

type CaptureRouteParams = {
  orgId: string;
  projectId: string;
};

type CaptureByIdRouteParams = CaptureRouteParams & {
  captureId: string;
};

type CaptureArtifactRouteParams = CaptureByIdRouteParams & {
  artifact: string;
};

const requireProjectAccess = async (orgId: string, projectId: string, userId: string) => {
  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } }
  });
  if (!membership) {
    return null;
  }

  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  return project;
};

capturesRouter.post('/', upload.any(), async (req: Request<CaptureRouteParams>, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const orgId = req.params.orgId;
  const projectId = req.params.projectId;
  if (!orgId || !projectId || !(await requireProjectAccess(orgId, projectId, user.id))) {
    res.status(403).json({ error: 'Forbidden for this project' });
    return;
  }

  const parsed = createCaptureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const notes = typeof parsed.data.notes === 'string' ? parsed.data.notes : null;

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const filesByField = new Map(files.map((file) => [file.fieldname, file]));
  const bundleFile = filesByField.get('bundle');

  if (!bundleFile) {
    res.status(400).json({ error: 'bundle file is required' });
    return;
  }

  const storage = getStorageAdapter();
  const captureId = crypto.randomUUID();
  const prefix = `orgs/${orgId}/projects/${projectId}/captures/${captureId}`;

  const putFile = async (fieldName: string, file?: Express.Multer.File): Promise<string | null> => {
    if (!file) return null;
    const key = `${prefix}/${fieldName}.${extensionFor(file)}`;
    await storage.putBlob({ key, content: file.buffer, contentType: file.mimetype });
    return key;
  };

  let architectureKey: string | null = null;
  try {
    const entries = JSON.parse(bundleFile.buffer.toString('utf-8')) as NormalizedEntry[];
    const report = analyzeArchitecture(entries);
    architectureKey = `${prefix}/architecture.report.json`;
    await storage.putBlob({
      key: architectureKey,
      content: Buffer.from(JSON.stringify(report.json, null, 2), 'utf-8'),
      contentType: 'application/json'
    });

    await storage.putBlob({
      key: `${prefix}/architecture.report.md`,
      content: Buffer.from(report.markdown, 'utf-8'),
      contentType: 'text/markdown'
    });
  } catch {
    architectureKey = null;
  }

  const bundleStorageKey = await putFile('bundle', bundleFile);
  const schemaStorageKey = await putFile('schema', filesByField.get('schema'));
  const openapiStorageKey = await putFile('openapi', filesByField.get('openapi'));
  const postmanStorageKey = await putFile('postman', filesByField.get('postman'));

  const capture = await prisma.capture.create({
    data: {
      id: captureId,
      projectId,
      createdByUserId: user.id,
      title: parsed.data.title,
      notes,
      statsJson: parsed.data.stats ? JSON.parse(parsed.data.stats) : null,
      status: env.USE_REDIS_QUEUE ? CaptureStatus.PROCESSING : CaptureStatus.READY,
      bundleStorageKey: bundleStorageKey ?? `${prefix}/bundle.json`,
      schemaStorageKey: schemaStorageKey ?? null,
      openapiStorageKey: openapiStorageKey ?? null,
      postmanStorageKey: postmanStorageKey ?? null,
      architectureStorageKey: architectureKey
    }
  });

  await enqueueCaptureAnalysis(capture.id);

  res.status(201).json(capture);
});

capturesRouter.get('/', async (req: Request<CaptureRouteParams>, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const orgId = req.params.orgId;
  const projectId = req.params.projectId;
  if (!orgId || !projectId || !(await requireProjectAccess(orgId, projectId, user.id))) {
    res.status(403).json({ error: 'Forbidden for this project' });
    return;
  }

  const captures = await prisma.capture.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' }
  });

  res.json(captures);
});

capturesRouter.get('/:captureId', async (req: Request<CaptureByIdRouteParams>, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const { orgId, projectId, captureId } = req.params;
  if (!orgId || !projectId || !captureId || !(await requireProjectAccess(orgId, projectId, user.id))) {
    res.status(403).json({ error: 'Forbidden for this project' });
    return;
  }

  const capture = await prisma.capture.findFirst({ where: { id: captureId, projectId } });
  if (!capture) {
    res.status(404).json({ error: 'Capture not found' });
    return;
  }

  res.json(capture);
});

capturesRouter.get('/:captureId/download/:artifact', async (req: Request<CaptureArtifactRouteParams>, res: Response) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const { orgId, projectId, captureId } = req.params;
  const artifact = req.params.artifact as ArtifactName;
  if (!orgId || !projectId || !captureId || !(await requireProjectAccess(orgId, projectId, user.id))) {
    res.status(403).json({ error: 'Forbidden for this project' });
    return;
  }

  if (!(artifact in ARTIFACT_MAP)) {
    res.status(400).json({ error: 'Unsupported artifact' });
    return;
  }

  const capture = await prisma.capture.findFirst({ where: { id: captureId, projectId } });
  if (!capture) {
    res.status(404).json({ error: 'Capture not found' });
    return;
  }

  const keyField = ARTIFACT_MAP[artifact];
  const storageKey = capture[keyField];
  if (!storageKey) {
    res.status(404).json({ error: `Artifact ${artifact} not found for this capture` });
    return;
  }

  const blob = await getStorageAdapter().getBlob(storageKey);
  if (!blob) {
    res.status(404).json({ error: 'Artifact blob missing' });
    return;
  }

  const contentType = blob.contentType ?? mime.lookup(storageKey) ?? 'application/octet-stream';
  res.setHeader('Content-Type', typeof contentType === 'string' ? contentType : 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${storageKey.split('/').pop() ?? 'artifact'}"`);
  res.send(blob.content);
});

const extensionFor = (file: Express.Multer.File): string => {
  const extension = file.originalname.split('.').pop();
  if (extension && extension.length <= 8) {
    return extension;
  }
  return file.mimetype.split('/').pop() ?? 'bin';
};
