import type { Database } from '../db/connection.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Dependencies shared by routes and services; injected so tests can swap the database and clock. */
export interface AppContext {
  db: Database;
  clock: Clock;
  secureCookies: boolean;
}
