// Launcher for `npm run ingest:local`: runs product ingestion against the LOCAL D1 database.
//
// SAFETY: this is the only entry point to ingestion, and it can only reach the local
// simulation. It opens D1 through Wrangler's local platform proxy with remote bindings
// switched off and an explicit local persistence directory (the same .wrangler/state that
// `npm run dev` and the db:*:local scripts use). There is no flag, environment variable, or
// code path here that selects the remote database. Do not add one; a remote ingestion command
// needs its own deliberate design (authentication, deployment, scheduling).
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));

const proxy = await getPlatformProxy({
  configPath: `${root}wrangler.jsonc`,
  persist: { path: `${root}.wrangler/state/v3` },
  remoteBindings: false,
});

try {
  // The engine is TypeScript with extensionless imports; Vite's module runner loads it as-is.
  const { module } = await runnerImport(`${root}src/server/ingestion/local-cli.ts`, { configFile: false, logLevel: 'error' });
  process.exitCode = await module.runLocalCli(proxy.env.DB, process.argv.slice(2), console);
} finally {
  await proxy.dispose();
}
