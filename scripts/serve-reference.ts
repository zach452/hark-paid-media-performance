/**
 * Serves the original Apps Script build (reference/app/Index.html) on localhost with the
 * exported dataset injected, so the new app can be compared against it pixel for pixel.
 *
 *   npm run reference:serve            # http://localhost:4173
 *   PORT=5000 npm run reference:serve
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', 'reference');
const PLACEHOLDER = 'var initial = /*__HARK_UPLOADS__*/null;';

// Apps Script's client bridge. Every method returns the runner so chained calls
// (withSuccessHandler(...).withFailureHandler(...).saveUploads(v)) resolve and do nothing.
const GOOGLE_STUB = `<script>(function(){var r=new Proxy({},{get:function(){return function(){return r}}});window.google={script:{run:r}}})();</script>`;

export function buildReferenceHtml(): string {
  const html = readFileSync(join(ROOT, 'app', 'Index.html'), 'utf8');
  if (!html.includes(PLACEHOLDER)) throw new Error(`Placeholder not found in Index.html: ${PLACEHOLDER}`);
  // Same escaping Code.gs applies before inlining, so "</script>" inside the data can't end the tag.
  const uploads = readFileSync(join(ROOT, 'data', 'uploads.json'), 'utf8').replace(/</g, '\\u003c');
  return html
    .replace(PLACEHOLDER, () => `var initial = ${uploads};`)
    .replace('<head>', () => `<head>\n${GOOGLE_STUB}`);
}

export function startReferenceServer(port: number): Promise<Server> {
  const body = buildReferenceHtml();
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4173);
  startReferenceServer(port).then(() => console.log(`Reference dashboard on http://localhost:${port}`));
}
