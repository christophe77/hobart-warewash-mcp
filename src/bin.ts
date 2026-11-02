#!/usr/bin/env node
/**
 * Entry point.
 *
 *   hobart-warewash-mcp          MCP over stdio (Claude Code, Claude Desktop, any local client)
 *   hobart-warewash-mcp --http   MCP over Streamable HTTP (ChatGPT, claude.ai, behind a tunnel)
 *
 * stdout belongs to the protocol in stdio mode, so everything human goes to stderr.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig } from './config.js';
import { HobartClient } from './hobart-client.js';
import { serveHttp } from './http.js';
import { createServer } from './server.js';

const VERSION = '0.1.0'; // keep in sync with package.json, server.json and the plugin

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new HobartClient(config);
  const factory = () => createServer(client, config, VERSION);

  console.error(
    `[hobart-warewash-mcp] ${VERSION} · write tools ${config.allowWrite ? 'ENABLED' : 'disabled (read-only)'}`,
  );

  let close: () => Promise<void>;
  if (process.argv.includes('--http')) {
    close = await serveHttp(config, factory);
  } else {
    const handle = serveStdio(factory, {
      onerror: (error) => {
        console.error('[hobart-warewash-mcp] stdio transport error:', error.message);
      },
    });
    close = () => handle.close();
    process.stdin.on('close', () => void shutdown());
  }

  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await close();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(`[hobart-warewash-mcp] ${error instanceof ConfigError ? error.message : String(error)}`);
  process.exit(1);
});
