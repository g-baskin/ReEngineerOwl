export const generateOpenApiDocument = (): Record<string, unknown> => ({
  openapi: '3.1.0',
  info: {
    title: 'ReEngineerOwl Local Server API',
    version: '0.1.0'
  },
  paths: {
    '/orgs': {
      post: { summary: 'Create organization' },
      get: { summary: 'List organizations for current user' }
    },
    '/orgs/{orgId}/projects': {
      post: { summary: 'Create project for organization' },
      get: { summary: 'List projects for organization' }
    },
    '/orgs/{orgId}/projects/{projectId}/captures': {
      post: { summary: 'Upload capture and artifacts' },
      get: { summary: 'List captures' }
    },
    '/orgs/{orgId}/projects/{projectId}/captures/{captureId}': {
      get: { summary: 'Fetch capture details' }
    },
    '/orgs/{orgId}/projects/{projectId}/captures/{captureId}/download/{artifact}': {
      get: { summary: 'Download generated artifact' }
    }
  }
});

export const generatePostmanCollection = (baseUrl: string): Record<string, unknown> => ({
  info: {
    name: 'ReEngineerOwl Local Server',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  item: [
    {
      name: 'Health',
      request: {
        method: 'GET',
        header: [],
        url: `${baseUrl}/health`
      }
    },
    {
      name: 'Create Org',
      request: {
        method: 'POST',
        header: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'X-User-Email', value: 'dev@example.com' }
        ],
        body: { mode: 'raw', raw: '{"name":"My Org"}' },
        url: `${baseUrl}/orgs`
      }
    }
  ]
});
