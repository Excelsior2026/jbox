import 'server-only';

import { closeDatabasePool } from '@/lib/db';

/**
 * Drains the connection pool when the platform asks the process to stop.
 *
 * This is the counterpart to running as a long-lived process. With per-request
 * functions there was nothing to shut down; with a pool, an abrupt exit leaves
 * server-side connections for Postgres to time out on its own, and repeated
 * deploys can accumulate them faster than they expire.
 *
 * Takes the process object as an argument so the behaviour is testable without
 * raising real signals in the test runner.
 */
export function registerShutdownHandlers(target: NodeJS.Process = process) {
  // Scoped to this registration rather than the module. Module-level mutable
  // state would be shared by every caller in the process -- the same hazard
  // the organization context store avoids with AsyncLocalStorage.
  let draining = false;

  const drain = async () => {
    // Orchestrators commonly send SIGTERM more than once before SIGKILL. A
    // second drain would run against an already-ended pool and throw during
    // shutdown, which reads as a crash rather than a clean stop.
    if (draining) return;
    draining = true;
    try {
      await closeDatabasePool();
    } catch {
      // Shutting down is not the moment to fail loudly: the process is going
      // away regardless, and an unhandled rejection here would mask whatever
      // actually triggered the stop.
    }
  };

  target.on('SIGTERM', drain);
  target.on('SIGINT', drain);
}
