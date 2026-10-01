import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ErrorState, PageSkeleton } from './components/States';
import { LoginPage, RegisterPage } from './pages/Auth';
import { CourseDetailPage } from './pages/CourseDetail';
import { CoursesPage } from './pages/Courses';
import { NotFoundPage } from './pages/NotFound';
import { ProgressPage } from './pages/Progress';
import { ReviewPage } from './pages/Review';
import { SettingsPage } from './pages/Settings';
import { TodayPage } from './pages/Today';
import { TopicDetailPage } from './pages/TopicDetail';
import { NewTopicPage } from './pages/NewTopic';
import { UpcomingPage } from './pages/Upcoming';

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Today'],
  [/^\/review/, 'Review'],
  [/^\/courses\/\d+/, 'Course'],
  [/^\/courses/, 'Courses'],
  [/^\/topics\/new/, 'Add topic'],
  [/^\/topics\//, 'Topic'],
  [/^\/upcoming/, 'Upcoming'],
  [/^\/progress/, 'Progress'],
  [/^\/settings/, 'Settings'],
  [/^\/login/, 'Log in'],
  [/^\/register/, 'Create account'],
];

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = title ? `${title} · Recall` : 'Recall';
    window.scrollTo(0, 0);
  }, [pathname]);
}

function RequireAuth() {
  const { user, loading, error, retry } = useAuth();
  const location = useLocation();
  if (loading) return <PageSkeleton />;
  if (error && !user) {
    return (
      <div className="main" style={{ marginLeft: 0 }}>
        <ErrorState error={error} onRetry={retry} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSkeleton />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  useDocumentTitle();
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route element={<RequireAuth />}>
        <Route index element={<TodayPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="review/:topicId" element={<ReviewPage />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="courses/:courseId" element={<CourseDetailPage />} />
        <Route path="topics/new" element={<NewTopicPage />} />
        <Route path="topics/:topicId" element={<TopicDetailPage />} />
        <Route path="upcoming" element={<UpcomingPage />} />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
