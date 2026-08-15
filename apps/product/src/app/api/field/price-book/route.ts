import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { priceBookReleaseSnapshotMatches } from '@/lib/customer-estimate-presentation';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { activePriceBookRow } from '@/lib/price-book';

export const dynamic = 'force-dynamic';

type PriceBookCursor = {
  version: 1;
  releaseId: string;
  filterKey: string;
  sortOrder: number;
  name: string;
  itemId: string;
};

type DatabaseRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{1,59}$/;

function filterKey(search: string, category: string) {
  return createHash('sha256')
    .update(JSON.stringify({ search, category }))
    .digest('base64url')
    .slice(0, 20);
}

function encodeCursor(cursor: PriceBookCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): PriceBookCursor | null {
  if (!value || value.length > 1024) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PriceBookCursor>;
    if (
      parsed.version !== 1
      || typeof parsed.releaseId !== 'string'
      || !UUID_PATTERN.test(parsed.releaseId)
      || typeof parsed.filterKey !== 'string'
      || parsed.filterKey.length !== 20
      || typeof parsed.sortOrder !== 'number'
      || !Number.isSafeInteger(parsed.sortOrder)
      || typeof parsed.name !== 'string'
      || parsed.name.length > 180
      || typeof parsed.itemId !== 'string'
      || !UUID_PATTERN.test(parsed.itemId)
    ) return null;

    return parsed as PriceBookCursor;
  } catch {
    return null;
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '');
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** jbox categories carry no code column; a stable slug is derived from the name. */
function categorySlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function GET(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'price_book.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Price book unavailable' }, 503);
  }

  const rawSearch = request.nextUrl.searchParams.get('q') ?? '';
  const search = rawSearch.trim();
  if (search.length > 80) return privateJson({ error: 'Search is too long' }, 400);

  const category = request.nextUrl.searchParams.get('category') ?? 'popular';
  if (category !== 'popular' && !CATEGORY_PATTERN.test(category)) {
    return privateJson({ error: 'Invalid category' }, 400);
  }

  const rawLimit = request.nextUrl.searchParams.get('limit') ?? '24';
  if (!/^\d{1,3}$/.test(rawLimit)) return privateJson({ error: 'Invalid limit' }, 400);
  const limit = Math.min(50, Math.max(1, Number(rawLimit)));

  const rawCursor = request.nextUrl.searchParams.get('cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return privateJson({ error: 'Invalid cursor' }, 400);

  const requestFilterKey = filterKey(search, category);
  if (cursor && cursor.filterKey !== requestFilterKey) {
    return privateJson({ error: 'Cursor does not match the active filters' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();
      const book = await activePriceBookRow();
      if (!book?.releaseId) return privateJson({ error: 'Price book is not initialized' }, 503);

      const releaseId = book.releaseId;
      const releaseStatus = book.releaseStatus;
      const releaseSnapshot = { releaseId, status: releaseStatus };
      if (!priceBookReleaseSnapshotMatches(releaseSnapshot, releaseSnapshot)) {
        return privateJson({ error: 'Price book release is invalid' }, 503);
      }
      if (cursor && cursor.releaseId !== releaseId) {
        return privateJson({ error: 'The price book changed; restart this search' }, 409);
      }

      const params: unknown[] = [releaseId];
      const conditions = [
        'release_item.release_id = $1::uuid',
        'item.active = true',
      ];

      if (category !== 'popular') {
        params.push(category);
        conditions.push(
          `regexp_replace(lower(category.name), '[^a-z0-9]+', '-', 'g') = $${params.length}`,
        );
      }

      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        conditions.push(
          `(position(lower(item.code) in lower($${params.length})) = 1`
          + ` OR lower(item.description) LIKE $${params.length})`,
        );
      }

      if (cursor) {
        params.push(cursor.sortOrder, cursor.name, cursor.itemId);
        conditions.push(
          `(category.position, lower(item.description), item.id) > ($${params.length - 2}, $${params.length - 1}, $${params.length}::uuid)`,
        );
      }

      params.push(limit + 1);
      const [itemRows, categoryRows] = await Promise.all([
        sql.query(`
          SELECT
            item.id,
            item.code,
            item.description,
            item.unit,
            item.taxable,
            version.id AS version_id,
            version.unit_price_cents,
            category.name AS category_name,
            category.position AS category_position,
            lower(item.description) AS cursor_name
          FROM price_book_release_items AS release_item
          JOIN price_book_items AS item ON item.id = release_item.item_id
          JOIN price_book_item_versions AS version ON version.id = release_item.item_version_id
          JOIN price_book_categories AS category ON category.id = item.category_id
          WHERE ${conditions.join('\n          AND ')}
          ORDER BY category.position, lower(item.description), item.id
          LIMIT $${params.length}
        `, params),
        sql.query(`
          SELECT name
          FROM price_book_categories
          ORDER BY position, name, id
        `),
      ]);

      const rows = itemRows as DatabaseRow[];
      const categories = categoryRows as DatabaseRow[];
      const currentBook = await activePriceBookRow();
      if (!currentBook || !priceBookReleaseSnapshotMatches(releaseSnapshot, {
        releaseId: currentBook.releaseId,
        status: currentBook.releaseStatus,
      })) {
        return privateJson({ error: 'The price book changed; restart this search' }, 409);
      }

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = pageRows.at(-1);
      const nextCursor = hasMore && lastRow
        ? encodeCursor({
            version: 1,
            releaseId,
            filterKey: requestFilterKey,
            sortOrder: asNumber(lastRow.category_position),
            name: asString(lastRow.cursor_name),
            itemId: asString(lastRow.id),
          })
        : null;

      return privateJson({
        book: {
          code: book.bookCode,
          currency: book.currencyCode,
          releaseId,
          release: book.releaseNo,
          status: releaseStatus,
        },
        categories: categories.map((row) => ({
          code: categorySlug(asString(row.name)),
          name: asString(row.name),
        })),
        items: pageRows.map((row) => ({
          id: asString(row.id),
          versionId: asString(row.version_id),
          code: asString(row.code),
          legacySlug: null,
          categoryCode: categorySlug(asString(row.category_name)),
          category: asString(row.category_name),
          name: asString(row.description),
          detail: '',
          unit: asString(row.unit),
          unitPriceCents: asNumber(row.unit_price_cents),
          taxable: Boolean(row.taxable),
          popular: false,
        })),
        nextCursor,
      });
    });
  } catch (error) {
    console.error('Authenticated price-book read failed.', error);
    return privateJson({ error: 'Price book unavailable' }, 503);
  }
}
