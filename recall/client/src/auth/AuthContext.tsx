import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@shared/api';
import { localDateIn, type LocalDate } from '@shared/dates';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import { browserTimeZone } from '../lib/format';

interface AuthValue {
  user: User | null;
  loading: boolean;
  error: unknown;
  retry: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const fetchMe = () => api.get<{ user: User | null }>('/auth/me').then((r) => r.user);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: Infinity, retry: 1 });

  const value = useMemo<AuthValue>(() => {
    // Drop the previous user's study data but keep the (observed) session query alive.
    const resetSession = (user: User | null) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
      qc.setQueryData(keys.me, user);
    };
    return {
      user: me.data ?? null,
      loading: me.isPending,
      error: me.error,
      retry: () => void me.refetch(),
      login: async (email, password) => resetSession((await api.post<{ user: User }>('/auth/login', { email, password })).user),
      register: async (name, email, password) =>
        resetSession((await api.post<{ user: User }>('/auth/register', { name, email, password, timezone: browserTimeZone() })).user),
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } finally {
          resetSession(null);
        }
      },
    };
  }, [me, qc]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user; only call inside routes guarded by RequireAuth. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called without a signed-in user');
  return user;
}

/** Today's date in the student's configured time zone. */
export function useToday(): LocalDate {
  return localDateIn(useUser().timezone);
}
