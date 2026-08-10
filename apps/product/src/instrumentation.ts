/**
 * Next calls register() once per server process, before handling requests.
 *
 * The runtime guard matters: instrumentation also runs in the edge runtime,
 * which has no process signals and no pg pool, and importing the database
 * module there would fail the build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { registerShutdownHandlers } = await import('@/lib/shutdown');
  registerShutdownHandlers();
}
