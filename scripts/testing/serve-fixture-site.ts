import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { PATHS } from '../lib/paths';

export interface LoggedRequest {
  method: string;
  path: string;
  at: string;
}

export interface FixtureServer {
  url: string;
  requestLog: LoggedRequest[];
  close: () => Promise<void>;
}

export interface FixtureChildProcess {
  url: string;
  close: () => Promise<void>;
}

export const DEFAULT_FIXTURE_PORT = 4173;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SITE_PAGES = [
  '/index.html',
  '/contact.html',
  '/danger.html',
  '/broken-link.html',
  '/responsive.html',
  '/create-user.html',
];

function fixtureOrigin(server: http.Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') return 'http://127.0.0.1';
  const host = address.address === '::' ? '127.0.0.1' : address.address;
  return `http://${host}:${address.port}`;
}

function buildRobotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
}

function buildSitemapXml(origin: string): string {
  const urls = SITE_PAGES.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Minimal static server for `fixtures/site/` with an in-memory request log, used to prove — with a
 * real crawl, not just a unit test of the classifier — that qa:test never sends a POST or other
 * state-changing request to a form/button it discovered. No new dependency: node:http only.
 */
export function startFixtureServer(port = 0): Promise<FixtureServer> {
  const requestLog: LoggedRequest[] = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      requestLog.push({ method: req.method ?? 'GET', path: url.pathname, at: new Date().toISOString() });

      if (url.pathname === '/old-home' || url.pathname === '/old-home/') {
        res.writeHead(301, { Location: '/index.html' });
        res.end();
        return;
      }

      if (url.pathname === '/robots.txt') {
        const origin = fixtureOrigin(server);
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.txt'] });
        res.end(buildRobotsTxt(origin));
        return;
      }

      if (url.pathname === '/sitemap.xml') {
        const origin = fixtureOrigin(server);
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.xml'] });
        res.end(buildSitemapXml(origin));
        return;
      }

      if (url.pathname === '/exposed' || url.pathname === '/exposed/') {
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(
          '<!doctype html><html><head><title>Index of /exposed</title></head><body><h1>Index of /exposed</h1><a href="notes.txt">notes.txt</a></body></html>'
        );
        return;
      }

      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = path.join(PATHS.fixturesSiteDir, pathname);

      if (!filePath.startsWith(PATHS.fixturesSiteDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': MIME_TYPES['.html'] });
        res.end('<h1>404 Not Found</h1>');
        return;
      }

      const ext = path.extname(filePath);
      const headers: Record<string, string> = {
        'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      };
      if (pathname === '/security.html') {
        headers['Set-Cookie'] = 'fixture_session=demo';
      }
      res.writeHead(200, headers);
      res.end(fs.readFileSync(filePath));
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve fixture server address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requestLog,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

/**
 * Child-process fixture. Use this when the parent will spawnSync Playwright — an in-process
 * http.Server cannot accept connections while the event loop is blocked.
 */
export function startFixtureChildProcess(
  port = Number(process.env.PORT) || DEFAULT_FIXTURE_PORT
): Promise<FixtureChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(PATHS.root, 'scripts', 'testing', 'serve-fixture-site.ts')],
    {
      cwd: PATHS.root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Fixture server did not start on port ${port}`));
    }, 20000);

    const onChunk = (buf: Buffer) => {
      const text = buf.toString();
      if (text.includes('EADDRINUSE')) {
        clearTimeout(timer);
        child.kill();
        reject(new Error(`EADDRINUSE:${port}`));
        return;
      }
      if (text.includes('Fixture site running')) {
        clearTimeout(timer);
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () =>
            new Promise<void>((res) => {
              if (child.exitCode !== null || child.signalCode !== null) {
                res();
                return;
              }
              child.once('exit', () => res());
              child.kill();
            }),
        });
      }
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Starts the fixture child process, or returns null when that port is already in use. */
export async function ensureFixtureChildProcess(
  port = DEFAULT_FIXTURE_PORT
): Promise<FixtureChildProcess | null> {
  try {
    return await startFixtureChildProcess(port);
  } catch (error) {
    if (String(error).includes('EADDRINUSE')) {
      return null;
    }
    throw error;
  }
}

if (require.main === module) {
  startFixtureServer(Number(process.env.PORT) || DEFAULT_FIXTURE_PORT).then((server) => {
    // eslint-disable-next-line no-console
    console.log(`Fixture site running at ${server.url}`);
  });
}
