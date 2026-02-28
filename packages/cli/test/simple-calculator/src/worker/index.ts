/**
 * Worker Entry Point
 *
 * Hono-based worker for handling API routes and serving static assets.
 */
import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// API Routes
// ============================================================================

app.get('/api/health', (c) => c.json({
  status: 'ok',
  timestamp: Date.now(),
}));

app.get('/api/', (c) => c.json({
  name: 'Nullshot Beta',
  version: '1.0.0',
}));

app.post('/api/echo', async (c) => {
  const body = await c.req.json();
  return c.json({ echo: body, timestamp: Date.now() });
});

app.get('/api/data', (c) => {
  return c.json({
    message: 'Hello from the API!',
    data: [],
  });
});

// ============================================================================
// Static Assets
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function getMimeType(path: string): string {
  const ext = path.match(/\.[^.]+$/)?.[0]?.toLowerCase() || '';
  return MIME_TYPES[ext] || 'application/octet-stream';
}

async function serveAsset(request: Request, assets: Fetcher): Promise<Response> {
  const response = await assets.fetch(request);
  if (response.headers.get('content-type')) {
    return response;
  }
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', getMimeType(url.pathname));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

app.get('/assets/*', (c) => serveAsset(c.req.raw, c.env.ASSETS));
app.get('/favicon.svg', (c) => serveAsset(c.req.raw, c.env.ASSETS));
app.get('/robots.txt', (c) => serveAsset(c.req.raw, c.env.ASSETS));

// SPA fallback
app.get('*', (c) => serveAsset(c.req.raw, c.env.ASSETS));

// ============================================================================
// Error Handling
// ============================================================================

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[Worker] Error:', err);
  return c.json({ error: err.name, message: err.message }, 500);
});

export default app;
