import { Router } from 'express';
import { generateOpenApiDocument, generatePostmanCollection } from '../services/analysis/exportArtifacts.js';

export const exportsRouter = Router();

exportsRouter.get('/openapi.json', (_req, res) => {
  res.json(generateOpenApiDocument());
});

exportsRouter.get('/postman.json', (req, res) => {
  const protocol = req.header('x-forwarded-proto') ?? req.protocol;
  const host = req.get('host') ?? 'localhost:4000';
  const baseUrl = `${protocol}://${host}`;
  res.json(generatePostmanCollection(baseUrl));
});
