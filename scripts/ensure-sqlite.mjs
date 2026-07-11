// Guards the Node run modes against the Electron native-ABI trap: `npm run
// electron`/`dist` rebuild better-sqlite3 for Electron's runtime, which then
// breaks `npm start`/`server`/`dev` under plain Node. This runs as a pre-hook,
// detects that mismatch, and rebuilds for Node automatically. Fast no-op when healthy.
//
// The load test runs in a CHILD process on purpose: dlopen-ing a wrong-ABI
// native addon can leave the process unstable (it segfaults on exit), so we
// isolate that to a throwaway child and keep this parent process clean — the
// pre-hook must exit 0 after a successful rebuild or npm would abort the run.
import { execSync, spawnSync } from 'node:child_process';

const probe = spawnSync(
  process.execPath,
  ['-e', "new (require('better-sqlite3'))(':memory:').close()"],
  { stdio: 'ignore' }
);

if (probe.status !== 0) { // non-zero exit, error, or killed by signal (segfault)
  console.log('• better-sqlite3 is not loadable under Node (likely built for the Electron app) — rebuilding…');
  try {
    execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
  } catch {
    console.error('\nCould not rebuild better-sqlite3 automatically. Run this manually:\n  npm rebuild better-sqlite3\n');
    process.exit(1);
  }
}
