// The scripts read .env with `tsx --env-file-if-exists`, but `react-router dev` and
// `react-router-serve` don't. Load it here, so the website sees the same settings as the
// scheduler. Variables already set in the environment win.
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
