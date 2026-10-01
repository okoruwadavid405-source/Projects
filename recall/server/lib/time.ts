import { localDateIn, type LocalDate } from '../../shared/dates.js';
import type { AppContext } from './context.js';

export const nowIso = (ctx: AppContext) => ctx.clock.now().toISOString();

/** "Today" for a user is always computed in their own time zone. */
export const todayFor = (ctx: AppContext, timezone: string): LocalDate => localDateIn(timezone, ctx.clock.now());
