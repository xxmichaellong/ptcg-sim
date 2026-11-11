import { parseContinuationHandoffText } from '@ptcgsim/protocol';

import type { AccountSql } from './account-store.js';

/**
 * The account's saved games (ADR-052 step 2): each one the `.ptcgsave`
 * text a save hands over (ADR-012), so a signed-in player resumes from the
 * list instead of a file. The text is a bearer capability; it stays here,
 * on the server, and is read back only by the player's own session. A save
 * goes at its own expiry, and the oldest goes past the limit.
 */

export const MAX_ACCOUNT_SAVES = 50;
const MAX_TITLE_LENGTH = 80;

export interface AccountSave {
  readonly id: string;
  readonly text: string;
  readonly title: string;
  readonly savedAt: number;
  readonly expiresAt: number;
}

/** A save as a device sends it, checked against its own text. */
export const readAccountSave = (
  id: string,
  value: unknown,
  now: number
): AccountSave | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const text: unknown = Reflect.get(value, 'text');
  const title: unknown = Reflect.get(value, 'title');
  const parsed = parseContinuationHandoffText(text);
  if (
    !parsed.ok ||
    parsed.value.saveId !== id ||
    parsed.value.expiresAt <= now ||
    typeof text !== 'string' ||
    (title !== undefined && typeof title !== 'string')
  ) {
    return undefined;
  }
  return {
    id,
    text,
    title: (title ?? '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TITLE_LENGTH),
    savedAt: now,
    expiresAt: parsed.value.expiresAt,
  };
};

export class AccountSavesSql {
  private made = false;

  constructor(private readonly sql: AccountSql) {}

  private tables(create: boolean): boolean {
    if (this.made) return true;
    const [found] = this.sql
      .exec(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'saved_game'"
      )
      .toArray();
    if (Number(found?.['n']) === 1) {
      this.made = true;
      return true;
    }
    if (!create) return false;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS saved_game (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         saved INTEGER NOT NULL,
         expires INTEGER NOT NULL,
         body TEXT NOT NULL
       )`
    );
    this.made = true;
    return true;
  }

  /** The saves not yet expired, newest first. */
  list(now: number): readonly AccountSave[] {
    if (!this.tables(false)) return [];
    const rows = this.sql
      .exec(
        'SELECT id, title, saved, expires, body FROM saved_game ORDER BY saved DESC'
      )
      .toArray();
    if (rows.some((row) => Number(row['expires']) <= now)) {
      this.sql.exec('DELETE FROM saved_game WHERE expires <= ?', now);
    }
    return rows
      .filter((row) => Number(row['expires']) > now)
      .map((row) => ({
        id: String(row['id']),
        title: String(row['title']),
        savedAt: Number(row['saved']),
        expiresAt: Number(row['expires']),
        text: String(row['body']),
      }));
  }

  put(save: AccountSave): void {
    this.tables(true);
    this.sql.exec(
      `INSERT OR REPLACE INTO saved_game (id, title, saved, expires, body)
       VALUES (?, ?, ?, ?, ?)`,
      save.id,
      save.title,
      save.savedAt,
      save.expiresAt,
      save.text
    );
    const [count] = this.sql
      .exec('SELECT COUNT(*) AS n FROM saved_game')
      .toArray();
    if (Number(count?.['n']) > MAX_ACCOUNT_SAVES) {
      this.sql.exec(
        `DELETE FROM saved_game WHERE id NOT IN (
           SELECT id FROM saved_game ORDER BY saved DESC LIMIT ?
         )`,
        MAX_ACCOUNT_SAVES
      );
    }
  }

  remove(id: string): void {
    if (!this.tables(false)) return;
    this.sql.exec('DELETE FROM saved_game WHERE id = ?', id);
  }
}
