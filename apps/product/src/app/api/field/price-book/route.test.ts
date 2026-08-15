import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/field-api-auth', () => ({
  getFieldPrincipal: () => ({ kind: 'field' }),
  fieldPrincipalCan: () => true,
  withFieldContext: async (_principal: unknown, work: () => Promise<unknown>) => work(),
}));

import { GET } from './route';

const RELEASE_ONE_ID = '550e8400-e29b-41d4-a716-446655440000';
const RELEASE_TWO_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function bookRow(releaseId: string, releaseNo: number) {
  return {
    release_id: releaseId,
    release_no: releaseNo,
    release_status: 'published',
  };
}

function itemRow(id: string, versionId: string, name: string, categoryPosition: number) {
  return {
    id,
    code: `PE-${name.slice(0, 3).toUpperCase()}-001`,
    description: name,
    unit: 'each',
    taxable: true,
    version_id: versionId,
    unit_price_cents: 12500,
    category_name: 'Service',
    category_position: categoryPosition,
    cursor_name: name.toLowerCase(),
  };
}

function request() {
  return new NextRequest('http://localhost/api/field/price-book?category=popular');
}

describe('field price-book catalog', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('serves the active published release with categories and items', async () => {
    queryMock
      .mockResolvedValueOnce([bookRow(RELEASE_ONE_ID, 1)])
      .mockResolvedValueOnce([
        itemRow('16fd2706-8baf-433b-82eb-8c7fada847da', '886313e1-3b8a-5372-9b90-0c9aee199e5d', 'Recessed light', 0),
        itemRow('7f3d8e5a-88b3-4ff3-8fe1-578ebd8908f1', 'c9bf9e57-1685-5c89-bafb-ff5af830be8a', 'Outlet drop', 1),
      ])
      .mockResolvedValueOnce([{ name: 'Service' }])
      .mockResolvedValueOnce([bookRow(RELEASE_ONE_ID, 1)]);

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.book.releaseId).toBe(RELEASE_ONE_ID);
    expect(payload.book.status).toBe('published');
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({
      code: 'PE-REC-001',
      name: 'Recessed light',
      unitPriceCents: 12500,
      taxable: true,
      popular: false,
    });
    expect(payload.categories).toEqual([{ code: 'service', name: 'Service' }]);
  });

  it('never exposes draft release pricing', async () => {
    queryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await GET(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Price book is not initialized' });
  });

  it('returns 409 when the published release changes during the read', async () => {
    const initialBook = bookRow(RELEASE_ONE_ID, 1);
    const currentBook = bookRow(RELEASE_TWO_ID, 2);

    queryMock
      .mockResolvedValueOnce([initialBook])
      .mockResolvedValueOnce([
        itemRow('16fd2706-8baf-433b-82eb-8c7fada847da', 'c9bf9e57-1685-5c89-bafb-ff5af830be8a', 'Concurrent update', 0),
      ])
      .mockResolvedValueOnce([{ name: 'Service' }])
      .mockResolvedValueOnce([currentBook]);

    const response = await GET(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'The price book changed; restart this search',
    });
  });

  it('rejects a mismatched cursor filter', async () => {
    const cursor = Buffer.from(JSON.stringify({
      version: 1,
      releaseId: RELEASE_ONE_ID,
      filterKey: 'aaaaaaaaaaaaaaaaaaaa',
      sortOrder: 1,
      name: 'outlet drop',
      itemId: '16fd2706-8baf-433b-82eb-8c7fada847da',
    })).toString('base64url');

    const req = new NextRequest(
      `http://localhost/api/field/price-book?category=popular&cursor=${cursor}`,
    );

    const response = await GET(req);
    expect(response.status).toBe(400);
  });
});
