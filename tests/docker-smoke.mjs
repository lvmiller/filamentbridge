import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: { ...process.env, ...(options.env ?? {}) }
  });
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('failed to allocate a free local port'));
      });
    });
  });
}

function staticValidate() {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  for (const text of ['filamentbridge-data', 'filamentbridge-keys', 'filamentbridge-backups', 'FILAMENTBRIDGE_DATABASE_PATH', ':3000']) {
    if (!compose.includes(text)) throw new Error(`docker-compose.yml missing ${text}`);
  }
  for (const text of ['node:24-alpine', 'npm run build', 'HEALTHCHECK', 'apps/server/dist/index.cjs']) {
    if (!dockerfile.includes(text)) throw new Error(`Dockerfile missing ${text}`);
  }
}

staticValidate();

const dockerVersion = run('docker', ['--version']);
if (dockerVersion.status !== 0) {
  console.log('Docker CLI unavailable; static Docker Compose validation passed but runtime smoke was not executed.');
  process.exit(0);
}

const project = `fb-smoke-${Date.now()}`;
const hostPort = String(await getFreePort());
const composeEnv = { FILAMENTBRIDGE_PORT: hostPort };
const baseUrl = `http://127.0.0.1:${hostPort}`;

const composeConfig = run('docker', ['compose', '-f', 'docker-compose.yml', 'config'], { stdio: 'inherit', env: composeEnv });
if (composeConfig.status !== 0) process.exit(composeConfig.status ?? 1);

const up = run('docker', ['compose', '-p', project, '-f', 'docker-compose.yml', 'up', '-d', '--build'], { stdio: 'inherit', env: composeEnv });
if (up.status !== 0) {
  run('docker', ['compose', '-p', project, '-f', 'docker-compose.yml', 'down', '-v'], { stdio: 'inherit', env: composeEnv });
  process.exit(up.status ?? 1);
}

try {
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/health`).catch(() => null);
    if (response?.ok) { healthy = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!healthy) throw new Error('health endpoint did not become ready');
  const setup = await fetch(`${baseUrl}/api/setup/status`).then((response) => response.json());
  if (typeof setup.data?.configured !== 'boolean') throw new Error('setup status did not return configured flag');
  console.log('Docker Compose runtime smoke passed');
} finally {
  run('docker', ['compose', '-p', project, '-f', 'docker-compose.yml', 'down', '-v'], { stdio: 'inherit', env: composeEnv });
}
