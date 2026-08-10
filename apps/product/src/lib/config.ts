// Configuration constants for the product plane
// All values are read from environment variables at import time.
// If a variable is missing, the code will throw early.

export const DATABASE_URL = process.env.DATABASE_URL;
export const DATABASE_URL_UNPOOLED = process.env.DATABASE_URL_UNPOOLED;
export const DATABASE_POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 10);
export const DATABASE_IDLE_TIMEOUT = Number(process.env.DATABASE_IDLE_TIMEOUT ?? 30000);
export const DATABASE_CONNECTION_TIMEOUT = Number(process.env.DATABASE_CONNECTION_TIMEOUT ?? 10000);

if (!DATABASE_URL && !DATABASE_URL_UNPOOLED) {
  throw new Error('DATABASE_URL or DATABASE_URL_UNPOOLED must be set');
}
