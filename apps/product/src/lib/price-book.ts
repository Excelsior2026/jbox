import 'server-only';

import { db } from '@/lib/db';

export type ActivePriceBookRow = {
  bookCode: string;
  currencyCode: string;
  releaseId: string;
  releaseNo: number;
  releaseStatus: 'draft' | 'published';
};

/**
 * The price book a commercial document may draw from: the latest PUBLISHED
 * release. jbox has no top-level `price_books` row -- book code and currency
 * are constants here (the money module is USD), and the release is the unit of
 * identity the estimator keys its catalog on.
 *
 * Draft releases are deliberately invisible to this read. Migration 004
 * enforces that unpublished pricing cannot enter a commercial document, so the
 * estimator offers the published release or nothing; a tenant with no published
 * release falls back to the client's offline starter catalog, whose lines are
 * stored unverified.
 */
export async function activePriceBookRow(): Promise<ActivePriceBookRow | null> {
  const rows = (await db().query(`
    SELECT
      release.id AS release_id,
      release.status AS release_status,
      (SELECT count(*)
         FROM price_book_releases AS prior
        WHERE prior.organization_id = release.organization_id
          AND prior.status = 'published'
          AND (prior.published_at, prior.id) <= (release.published_at, release.id)
      ) AS release_no
    FROM price_book_releases AS release
    WHERE release.status = 'published'
    ORDER BY release.published_at DESC, release.id DESC
    LIMIT 1
  `)) as Array<Record<string, unknown>>;

  if (!rows.length) return null;

  const row = rows[0];
  const releaseStatus = row.release_status === 'published' ? 'published' : 'draft';
  return {
    bookCode: 'PB',
    currencyCode: 'USD',
    releaseId: row.release_id as string,
    releaseNo: Number(row.release_no) || 1,
    releaseStatus,
  };
}
