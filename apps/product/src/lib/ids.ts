/**
 * Shared identifiers. jbox addresses every record by its internal uuid, so a
 * route that does not recognize an id format returns "not found" instead of
 * reaching the database with a malformed WHERE clause.
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
