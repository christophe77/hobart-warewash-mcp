/**
 * Configuration, read once from the environment.
 *
 * The defaults are the production Hobart Cloud-to-Cloud endpoints; only the account is
 * mandatory. A `.env` file in the working directory is loaded when present, so the same
 * build runs from a terminal, from Claude's plugin config, or behind a tunnel.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface HobartConfig {
  readonly baseUrl: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly scope: string;
  readonly username: string;
  readonly password: string;
  /** Write tools (register, settings) are only registered when this is true. */
  readonly allowWrite: boolean;
  readonly host: string;
  readonly port: number;
  /** Shared secret guarding the HTTP endpoint. Undefined means stdio-only use. */
  readonly httpSecret: string | undefined;
}

export class ConfigError extends Error {}

/** The package's own .env, found from this file, so a plugin launched from any folder finds it. */
const PACKAGE_ENV = fileURLToPath(new URL('../.env', import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HobartConfig {
  // Values already in the environment win: loadEnvFile never overwrites them.
  for (const file of ['.env', PACKAGE_ENV]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const username = env['HOBART_USERNAME']?.trim() ?? '';
  const password = env['HOBART_PASSWORD'] ?? '';
  if (username === '' || password === '') {
    throw new ConfigError('HOBART_USERNAME and HOBART_PASSWORD must be set (see .env.example).');
  }

  const secret = env['MCP_HTTP_SECRET']?.trim();

  return {
    baseUrl: (
      env['HOBART_BASE_URL'] ?? 'https://cloud2cloud.smartconnect365.com/api/device/visio/c2c/v1.0'
    ).replace(/\/+$/, ''),
    tokenEndpoint:
      env['HOBART_TOKEN_ENDPOINT'] ??
      'https://login.smartconnect365.com/itwfegcc.onmicrosoft.com/oauth2/v2.0/token?p=b2c_1_c2c_api_oauth_token',
    clientId: env['HOBART_CLIENT_ID'] ?? '9f86a02d-ac02-4b46-88cd-4e884ca29cb8',
    scope:
      env['HOBART_SCOPE'] ??
      'https://itwfegcc.onmicrosoft.com/ConnectedCloud/Machines.Read openId profile offline_access',
    username,
    password,
    allowWrite: env['HOBART_ALLOW_WRITE']?.toLowerCase() === 'true',
    host: env['HOST'] ?? '127.0.0.1',
    port: Number.parseInt(env['PORT'] ?? '3333', 10),
    httpSecret: secret === undefined || secret === '' ? undefined : secret,
  };
}
