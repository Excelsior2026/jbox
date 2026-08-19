import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, isDatabaseConfigured } from '@/lib/db';
import { withTenant } from '@/lib/tenant';
import styles from './track.module.css';

export const dynamic = 'force-dynamic';

type TrackPageProps = {
  searchParams: Promise<{ token?: string }>;
};

type TrackedDocument = {
  type: 'estimate' | 'invoice';
  displayId: string;
  title: string;
  status: string;
  statusColor: string;
  createdAt: string;
  totalCents?: number;
  link: string;
};

function getStatusColor(type: string, status: string): string {
  if (type === 'estimate') {
    if (status === 'signed') return '#059669';
    if (status === 'declined') return '#ef4444';
    return '#3b82f6';
  }
  if (type === 'invoice') {
    if (status === 'paid') return '#059669';
    if (status === 'cancelled') return '#ef4444';
    if (status === 'partially_paid') return '#f59e0b';
    return '#10b981';
  }
  return '#6b7280';
}

function formatStatus(type: string, status: string): string {
  if (type === 'estimate') {
    if (status === 'signed') return 'Approved';
    if (status === 'declined') return 'Declined';
    return 'Pending';
  }
  if (type === 'invoice') {
    return status.replace('_', ' ');
  }
  return status;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function DocumentCard({ doc }: { doc: TrackedDocument }) {
  return (
    <Link href={doc.link} className={styles.documentCard}>
      <div className={styles.documentHeader}>
        <span className={styles.documentType}>{doc.type}</span>
        <span className={styles.documentId}>{doc.displayId}</span>
      </div>
      <h3 className={styles.documentTitle}>{doc.title}</h3>
      <div className={styles.documentMeta}>
        <span
          className={styles.statusBadge}
          style={{
            background: getStatusColor(doc.type, doc.status) + '20',
            color: getStatusColor(doc.type, doc.status),
          }}
        >
          {formatStatus(doc.type, doc.status)}
        </span>
        <span className={styles.documentDate}>
          {new Date(doc.createdAt).toLocaleDateString()}
        </span>
      </div>
      {doc.totalCents !== undefined && (
        <div className={styles.documentTotal}>
          {formatCents(doc.totalCents)}
        </div>
      )}
    </Link>
  );
}

export default async function TrackPage({ searchParams }: TrackPageProps) {
  if (!isDatabaseConfigured()) notFound();

  const params = await searchParams;
  const token = params.token;

  if (!token) {
    return (
      <div className={styles.trackPage}>
        <div className={styles.trackContainer}>
          <div className={styles.trackHeader}>
            <h1>Track Your Project</h1>
            <p>Enter your tracking code to view the status of your estimates and invoices.</p>
          </div>
          <form className={styles.trackForm} action="/track" method="get">
            <input
              type="text"
              name="token"
              placeholder="Enter tracking code"
              className={styles.trackInput}
              required
            />
            <button type="submit" className={styles.trackButton}>
              Track
            </button>
          </form>
        </div>
      </div>
    );
  }

  const documents: TrackedDocument[] = [];

  await withTenant(async () => {
    const sql = db();

    const estimates = (await sql.query(
      `SELECT e.id, e.display_id, e.title, e.status, e.created_at, e.total_cents
       FROM estimates e
       JOIN customer_access_grants g ON g.document_type = 'estimate' AND g.document_id = e.id
       WHERE g.token_hash = encode(digest($1::text, 'sha256'), 'hex')
         AND g.status = 'active'
       ORDER BY e.created_at DESC
       LIMIT 10`,
      [token],
    )) as Array<{
      id: string; display_id: string; title: string; status: string;
      created_at: string; total_cents: number;
    }>;

    for (const e of estimates) {
      documents.push({
        type: 'estimate',
        displayId: e.display_id,
        title: e.title,
        status: e.status,
        statusColor: getStatusColor('estimate', e.status),
        createdAt: e.created_at,
        totalCents: e.total_cents,
        link: `/estimates/${token}`,
      });
    }

    const invoices = (await sql.query(
      `SELECT i.id, i.display_id, i.title, i.status, i.created_at, i.total_cents
       FROM invoices i
       JOIN customer_access_grants g ON g.document_type = 'invoice' AND g.document_id = i.id
       WHERE g.token_hash = encode(digest($1::text, 'sha256'), 'hex')
         AND g.status = 'active'
       ORDER BY i.created_at DESC
       LIMIT 10`,
      [token],
    )) as Array<{
      id: string; display_id: string; title: string; status: string;
      created_at: string; total_cents: number;
    }>;

    for (const i of invoices) {
      documents.push({
        type: 'invoice',
        displayId: i.display_id,
        title: i.title,
        status: i.status,
        statusColor: getStatusColor('invoice', i.status),
        createdAt: i.created_at,
        totalCents: i.total_cents,
        link: `/invoices/${token}`,
      });
    }
  });

  if (!documents.length) {
    return (
      <div className={styles.trackPage}>
        <div className={styles.trackContainer}>
          <div className={styles.trackHeader}>
            <h1>No Results Found</h1>
            <p>No documents found for this tracking code. Please check your code and try again.</p>
          </div>
          <Link href="/track" className={styles.trackButton}>
            Try another code
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.trackPage}>
      <div className={styles.trackContainer}>
        <div className={styles.trackHeader}>
          <h1>Your Project Status</h1>
          <p>Track the status of your estimates and invoices.</p>
        </div>

        <div className={styles.documentGrid}>
          {documents.map((doc) => (
            <DocumentCard key={`${doc.type}-${doc.displayId}`} doc={doc} />
          ))}
        </div>

        <div className={styles.trackFooter}>
          <Link href="/track" className={styles.trackButtonSecondary}>
            Track another code
          </Link>
        </div>
      </div>
    </div>
  );
}
