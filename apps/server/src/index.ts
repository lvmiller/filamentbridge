import { createApp, loadConfig } from './app';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
