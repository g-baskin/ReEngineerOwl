export type NormalizedEntry = {
  source: string;
  method?: string;
  route?: string;
  statusCode?: number;
  component?: string;
};

export type ArchitectureReport = {
  generatedAt: string;
  totals: {
    entries: number;
    bySource: Record<string, number>;
    byComponent: Record<string, number>;
    byRoute: Record<string, number>;
  };
  topRoutes: Array<{ route: string; count: number }>;
};

const increment = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

export const analyzeArchitecture = (entries: NormalizedEntry[]): { json: ArchitectureReport; markdown: string } => {
  const bySource: Record<string, number> = {};
  const byComponent: Record<string, number> = {};
  const byRoute: Record<string, number> = {};

  for (const entry of entries) {
    increment(bySource, entry.source || 'unknown');
    if (entry.component) {
      increment(byComponent, entry.component);
    }
    if (entry.route) {
      const key = `${entry.method ?? 'GET'} ${entry.route}`;
      increment(byRoute, key);
    }
  }

  const topRoutes = Object.entries(byRoute)
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const json: ArchitectureReport = {
    generatedAt: new Date().toISOString(),
    totals: {
      entries: entries.length,
      bySource,
      byComponent,
      byRoute
    },
    topRoutes
  };

  const markdown = [
    '# Architecture Report',
    '',
    `Generated at: ${json.generatedAt}`,
    '',
    `Total entries: ${json.totals.entries}`,
    '',
    '## Top Routes',
    ...topRoutes.map((item) => `- ${item.route}: ${item.count}`),
    '',
    '## Source Distribution',
    ...Object.entries(bySource).map(([source, count]) => `- ${source}: ${count}`)
  ].join('\n');

  return { json, markdown };
};
