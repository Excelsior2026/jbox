import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { classifyHost } from '@/lib/host';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';
import { saveUpload } from '@/lib/storage';
import { TenantResolutionError, loadInForceConfig, withTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function json(response: Record<string, unknown>, status: number): Response {
  return Response.json(response, { status });
}

function extensionFor(contentType: string, filename: string): string {
  const byType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  if (byType[contentType]) return byType[contentType];
  const fromName = filename.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{1,8}$/.test(fromName) ? fromName : 'bin';
}

/**
 * The storefront's inbound-lead inbox: creates a service_request (and its
 * photos) for the resolved tenant. Everything — the number allocation, the
 * request insert, and the photo rows — happens in ONE statement inside a
 * single transaction, so a partial request can never be written.
 *
 * IMPORTANT: Tenant resolution happens BEFORE reading the multipart body.
 * A hostile actor sending a 40 MB payload to an invalid hostname must not
 * exhaust server memory before we know whether the hostname is valid. The
 * lightweight host classification rejects unknown hosts before any I/O.
 */
export async function POST(request: NextRequest) {
  // --- Phase 1: fast host gate (no I/O) ------------------------------------
  const host = (await headers()).get('host') ?? '';
  if (classifyHost(host) !== 'tenant') {
    return json({ error: 'This storefront is not available.' }, 404);
  }

  // --- Phase 1.5: rate limit intake by IP (before consuming body) ----------
  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`requests:${ip}`, { capacity: 15, refillPerMinute: 5 }))) {
    return json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  // --- Phase 2: parse body (now we know host and rate limit are good) -------
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Request body was not valid multipart form data.' }, 400);
  }

  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };

  const contactName = field('contactName');
  const contactEmail = field('contactEmail');
  const contactPhone = field('contactPhone');
  const serviceSlug = field('serviceSlug');
  const serviceAddress = field('serviceAddress');
  const town = field('town');
  const postalCode = field('postalCode');
  const summary = field('summary');
  const message = field('message');

  const problems: string[] = [];
  if (!contactName || contactName.length > 200) problems.push('a name is required');
  if (!summary || summary.length > 300) problems.push('a short summary is required');
  if (contactEmail.length > 320) problems.push('email is too long');
  if (contactPhone.length > 40) problems.push('phone is too long');
  if (!contactEmail && !contactPhone) problems.push('an email or phone number is required');
  if (serviceAddress.length > 200) problems.push('service address is too long');
  if (town.length > 100) problems.push('town is too long');
  if (postalCode.length > 20) problems.push('postal code is too long');
  if (message.length > 4000) problems.push('details are too long');

  const files = form
    .getAll('photos')
    .filter((entry): entry is File => typeof entry !== 'string');
  if (files.length > MAX_PHOTOS) problems.push(`at most ${MAX_PHOTOS} photos`);
  for (const file of files) {
    if (file.size > MAX_PHOTO_BYTES) problems.push('each photo must be under 8 MB');
  }
  if (problems.length) {
    return json({ error: problems.join('; ') }, 400);
  }

  // --- Phase 3: DB-verified tenant resolution + write ----------------------
  return withTenant(async () => {
    const config = await loadInForceConfig();
    if (!config) return json({ error: 'This storefront is not available yet.' }, 503);

    if (serviceSlug && !config.services.some((service) => service.slug === serviceSlug)) {
      return json({ error: 'Unknown service.' }, 400);
    }
    const selected = config.services.find((service) => service.slug === serviceSlug);
    const finalSummary = selected ? `[${selected.name}] ${summary}` : summary;

    const photos: Array<{
      storage_key: string;
      filename: string;
      content_type: string;
      size_bytes: number;
      position: number;
    }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      photos.push({
        storage_key: await saveUpload(
          Buffer.from(await file.arrayBuffer()),
          extensionFor(file.type, file.name),
        ),
        filename: file.name.slice(0, 255),
        content_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        position: index,
      });
    }

    const rows = await db().query(
      `WITH allocated AS (
         SELECT allocate_document_number('service_request') AS n
       ),
       request AS (
         INSERT INTO service_requests
           (organization_id, document_number, display_id, status, source,
            contact_name, contact_email, contact_phone, service_address, town,
            postal_code, summary, message)
         SELECT app_require_organization_id(), allocated.n,
                $1 || lpad(allocated.n::text, 4, '0'), 'new', 'storefront',
                $2, $3, $4, $5, $6, $7, $8, $9
         FROM allocated
         RETURNING id, display_id
       ),
       photos_created AS (
         INSERT INTO service_request_photos
           (organization_id, service_request_id, storage_key, filename,
            content_type, size_bytes, position)
         SELECT app_require_organization_id(), request.id, photo.storage_key,
                photo.filename, photo.content_type, photo.size_bytes, photo.position
         FROM json_to_recordset($10::json) AS photo(
           storage_key text, filename text, content_type text,
           size_bytes bigint, position integer)
         CROSS JOIN request
         RETURNING storage_key
       )
       SELECT request.display_id,
              COALESCE(
                (SELECT json_agg(photos_created.storage_key) FROM photos_created),
                '[]'::json
              ) AS photo_keys
       FROM request`,
      [
        `${config.documents.prefixes.serviceRequest}-`,
        contactName,
        contactEmail,
        contactPhone,
        serviceAddress,
        town,
        postalCode,
        finalSummary,
        message,
        JSON.stringify(photos),
      ],
    );

    return json({ ok: true, displayId: rows[0]?.display_id }, 201);
  }).catch((error: unknown) => {
    if (error instanceof TenantResolutionError) {
      return json({ error: 'This storefront is not available.' }, 404);
    }
    throw error;
  });
}
