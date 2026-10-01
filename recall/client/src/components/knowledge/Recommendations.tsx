import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import type { Recommendation } from '@shared/knowledgeApi';
import { CourseTag } from '../Badges';

/** "What should I study?" — every item shows the real reasons it was chosen. */
export function RecommendationList({ items, showCourse, onStudy }: { items: Recommendation[]; showCourse?: boolean; onStudy?: (r: Recommendation) => void }) {
  if (items.length === 0) {
    return (
      <p className="muted">
        Nothing stands out right now — no reviews are due, and nothing confirmed in your course material is waiting to be started.
      </p>
    );
  }
  return (
    <ol>
      {items.map((r, i) => (
        <li key={`${r.course.id}-${r.topicKey ?? r.topicName}`} className="rec">
          <span className="n" aria-hidden>
            {i + 1}
          </span>
          <div className="main-col" style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <strong>{r.topicName}</strong>
              {showCourse && <CourseTag course={r.course} />}
            </div>
            <ul aria-label="Reasons">
              {r.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
          {r.recallTopicId ? (
            <Link to={`/review/${r.recallTopicId}`} className="btn btn-secondary btn-sm" aria-label={`Review ${r.topicName}`}>
              Review
            </Link>
          ) : onStudy ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStudy(r)} aria-label={`Start studying ${r.topicName}`}>
              Start
            </button>
          ) : (
            <Link to={`/courses/${r.course.id}?tab=knowledge`} className="btn btn-secondary btn-sm" aria-label={`Open ${r.topicName}`}>
              Open
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

export function RecommendationHeading() {
  return (
    <h2 className="row">
      <Compass size={18} aria-hidden /> What should I study?
    </h2>
  );
}
