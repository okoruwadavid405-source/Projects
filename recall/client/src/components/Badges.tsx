import { AlarmClock, AlertCircle, Award, Repeat, Sparkles, Sprout } from 'lucide-react';
import type { CourseRef } from '@shared/api';
import type { Rating, TopicDisplayStatus } from '@shared/scheduler';
import { RATING_META, STATUS_LABEL } from '../lib/format';

const STATUS_ICON = {
  overdue: AlertCircle,
  due: AlarmClock,
  new: Sparkles,
  learning: Sprout,
  reviewing: Repeat,
  mastered: Award,
} satisfies Record<TopicDisplayStatus, unknown>;

/** Status is always conveyed by icon + text, never by colour alone. */
export function StatusBadge({ status }: { status: TopicDisplayStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`badge badge-${status}`}>
      <Icon aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function RatingBadge({ rating }: { rating: Rating }) {
  return <span className={`badge rating-${rating}`}>{RATING_META[rating].label}</span>;
}

export function CourseTag({ course }: { course: Pick<CourseRef, 'code' | 'color'> }) {
  return <span className={`course-tag c-${course.color}`}>{course.code}</span>;
}

export function DemoBadge() {
  return <span className="badge badge-demo">Demo</span>;
}
