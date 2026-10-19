import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReferenceHtml } from '../scripts/serve-reference';

describe('reference server', () => {
  const html = buildReferenceHtml();

  it('injects uploads.json in place of the placeholder', () => {
    expect(html).not.toContain('var initial = /*__HARK_UPLOADS__*/null;');
    const uploads = JSON.parse(
      readFileSync(join(__dirname, '..', 'reference', 'data', 'uploads.json'), 'utf8'),
    );
    expect(html).toContain(`var initial = {"generatedAt":"${uploads.generatedAt}"`);
  });

  it('escapes "<" in the inlined data so it cannot close the script tag', () => {
    const start = html.indexOf('var initial = ');
    const end = html.indexOf(';\n', start);
    expect(html.slice(start, end)).not.toContain('<');
  });

  it('stubs google.script.run before the loader script runs', () => {
    expect(html.indexOf('window.google={script:{run:r}}')).toBeLessThan(html.indexOf('var initial = '));
  });
});
