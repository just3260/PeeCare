import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Test Tool API container contract', () => {
  it('builds a production-only runtime that drops root before starting the server', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('FROM '));

    expect(dockerfile).toContain('AS build');
    expect(runtimeStage).toContain('ENV NODE_ENV=production');
    expect(runtimeStage).toContain('npm ci --omit=dev --omit=optional');
    expect(runtimeStage).toMatch(/USER node\s+CMD \["node", "dist\/server\.js"\]/);
    expect(runtimeStage).not.toContain('COPY services/test-tool-api/test');
  });

  it('uses the repository root as the Cloud Build context', () => {
    const cloudbuild = JSON.parse(
      readFileSync(new URL('../cloudbuild.json', import.meta.url), 'utf8'),
    ) as { steps: Array<{ args: string[] }> };

    expect(cloudbuild.steps[0]?.args).toEqual([
      'build',
      '--platform',
      'linux/amd64',
      '--file',
      'services/test-tool-api/Dockerfile',
      '--tag',
      '${_IMAGE}',
      '.',
    ]);
  });
});
