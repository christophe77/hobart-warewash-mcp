/**
 * The MCP server over Streamable HTTP, for clients that only speak to a URL: ChatGPT
 * (Apps / developer mode) and claude.ai custom connectors.
 *
 * Those clients cannot send a custom header, so the shared secret is accepted either as a
 * bearer token or as the last path segment (`/mcp/<secret>`). Without a secret the server
 * only answers requests addressed to localhost, which keeps a DNS-rebinding page in a
 * browser from reaching it.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler, localhostAllowedHostnames, validateHostHeader } from '@modelcontextprotocol/server';
import type { HobartConfig } from './config.js';

export async function serveHttp(config: HobartConfig, factory: () => McpServer): Promise<() => Promise<void>> {
  const handler = createMcpHandler(factory, {
    onerror: (error) => {
      console.error('[hobart-warewash-mcp] HTTP transport error:', error.message);
    },
  });

  const server = createHttpServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      console.error('[hobart-warewash-mcp] request failed:', error);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }

    const segments = url.pathname.split('/').filter((s) => s !== '');
    if (segments[0] !== 'mcp' || segments.length > 2) {
      res.writeHead(404).end();
      return;
    }

    if (config.httpSecret === undefined) {
      const host = validateHostHeader(req.headers.host, localhostAllowedHostnames());
      if (!host.ok) {
        res.writeHead(403).end('Set MCP_HTTP_SECRET to accept requests from outside localhost.');
        return;
      }
    } else {
      const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const presented = segments[1] ?? bearer;
      if (presented === undefined || !sameSecret(presented, config.httpSecret)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
        return;
      }
    }

    const response = await handler.fetch(await toRequest(req, url));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body === null) {
      res.end();
      return;
    }
    // Stream, so server-sent events reach the client as they are written.
    for await (const chunk of response.body) {
      res.write(chunk);
    }
    res.end();
  }

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const where = `http://${config.host}:${String(config.port)}/mcp`;
  console.error(
    `[hobart-warewash-mcp] Serving MCP over HTTP at ${where}${config.httpSecret === undefined ? ' (localhost only, no secret set)' : '/<MCP_HTTP_SECRET>'}`,
  );

  return async () => {
    await handler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}

async function toRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const method = req.method ?? 'GET';
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(new URL(url.pathname + url.search, `http://${req.headers.host ?? 'localhost'}`), {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
