import { CheckCircle2, FileText, Globe, HelpCircle, History, Sparkles } from 'lucide-react';
import { STATUS_META, type EvidenceStatus } from '@shared/knowledge';

const ICON = { confirmed: CheckCircle2, your_materials: FileText, historical: History, public: Globe, suggested: Sparkles, unconfirmed: HelpCircle };

/** Evidence status with icon + text (never colour alone) and the plain-language explanation as a tooltip. */
export function EvidenceBadge({ status, compact }: { status: EvidenceStatus; compact?: boolean }) {
  const Icon = ICON[status];
  return (
    <span className={`badge ev-${status}`} title={STATUS_META[status].explanation}>
      <Icon aria-hidden />
      {compact && status === 'confirmed' ? '✓ Confirmed' : STATUS_META[status].label}
    </span>
  );
}
