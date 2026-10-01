import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ErrorState, PageSkeleton } from './components/States';
import { LoginPage, RegisterPage } from './pages/Auth';
import { CoursesPage } from './pages/Courses';
import { NotFoundPage } from './pages/NotFound';
import { ReviewPage } from './pages/Review';
import { TodayPage } from './pages/Today';

// Less-used pages load on demand to keep the first load small.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const CourseDetailPage = page(() => import('./pages/CourseDetail'), 'CourseDetailPage');
const ConnectCoursePage = page(() => import('./pages/ConnectCourse'), 'ConnectCoursePage');
const ProgressPage = page(() => import('./pages/Progress'), 'ProgressPage');
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');
const TopicDetailPage = page(() => import('./pages/TopicDetail'), 'TopicDetailPage');
const UpcomingPage = page(() => import('./pages/Upcoming'), 'UpcomingPage');
const NewTopicPage = page(() => import('./pages/NewTopic'), 'NewTopicPage');

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Today'],
  [/^\/review/, 'Review'],
  [/^\/courses\/\d+/, 'Course'],
  [/^\/courses/, 'Courses'],
  [/^\/connect/, 'Add from your school'],
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
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly>
              <RegisterPage />
            </GuestOnly>
          }
        />
        <Route element={<RequireAuth />}>
          <Route index element={<TodayPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="review/:topicId" element={<ReviewPage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:courseId" element={<CourseDetailPage />} />
          <Route path="connect" element={<ConnectCoursePage />} />
          <Route path="topics/new" element={<NewTopicPage />} />
          <Route path="topics/:topicId" element={<TopicDetailPage />} />
          <Route path="upcoming" element={<UpcomingPage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
