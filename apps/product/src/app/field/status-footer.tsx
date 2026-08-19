import styles from './field.module.css';

export type StatusFooterProps = {
  statusLabel: string;
  statusColor: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled' | 'pending_approval' | 'approved' | 'rejected';
  children?: React.ReactNode;
};

const STATUS_DOT_CLASS: Record<string, string> = {
  draft: styles.statusDotDraft,
  issued: styles.statusDotIssued,
  partially_paid: styles.statusDotPartiallyPaid,
  paid: styles.statusDotPaid,
  cancelled: styles.statusDotCancelled,
  pending_approval: styles.statusDotPendingApproval,
  approved: styles.statusDotApproved,
  rejected: styles.statusDotRejected,
};

export function StatusFooter({ statusLabel, statusColor, children }: StatusFooterProps) {
  return (
    <footer className={styles.statusFooter} role="status" aria-label={`Status: ${statusLabel}`}>
      <div className={styles.statusFooterInner}>
        <div className={styles.statusFooterBadge}>
          <span className={`${styles.statusDot} ${STATUS_DOT_CLASS[statusColor] ?? styles.statusDotDraft}`} />
          <span>{statusLabel}</span>
        </div>
        {children && (
          <div className={styles.statusFooterActions}>
            {children}
          </div>
        )}
      </div>
    </footer>
  );
}
