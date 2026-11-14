import { t } from '@lingui/core/macro';
import { parseContinuationHandoffText } from '@ptcgsim/protocol';
import { useCallback, useEffect, useState } from 'react';

import { toast } from '../ui/toast.js';
import { AccountRequestError } from './account-api.js';
import { refreshAccount, useAccount } from './account-state.js';

/**
 * Saved games kept in the account (ADR-052 step 2), so a signed-in player
 * resumes from a list rather than a `.ptcgsave` file. Each is the text the
 * file would hold, a capability (ADR-012): read from the account when the
 * list is shown, held in memory only, never in browser storage.
 */

export interface AccountSave {
  readonly id: string;
  readonly text: string;
  readonly title: string;
  readonly savedAt: number;
  readonly expiresAt: number;
}

const request = async (
  path: string,
  init: RequestInit = {}
): Promise<Response> => {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    if (response.status === 401) void refreshAccount();
    throw new AccountRequestError(response.status, 'failed');
  }
  return response;
};

const readSave = (value: unknown): AccountSave | undefined => {
  const read = (key: string): unknown => Reflect.get(Object(value), key);
  const [id, text, title, savedAt, expiresAt] = [
    read('id'),
    read('text'),
    read('title'),
    read('savedAt'),
    read('expiresAt'),
  ];
  return typeof id === 'string' &&
    typeof text === 'string' &&
    typeof title === 'string' &&
    typeof savedAt === 'number' &&
    typeof expiresAt === 'number'
    ? { id, text, title, savedAt, expiresAt }
    : undefined;
};

export const fetchAccountSaves = async (): Promise<readonly AccountSave[]> => {
  const body: unknown = await (await request('/v2/account/saves')).json();
  const saves: unknown = Reflect.get(Object(body), 'saves');
  return Array.isArray(saves)
    ? saves.flatMap((save) => readSave(save) ?? [])
    : [];
};

export const removeAccountSave = async (id: string): Promise<void> => {
  await request(`/v2/account/saves/${id}`, { method: 'DELETE' });
  changed();
};

/**
 * Keeps a save in the account, as a file would have been written: true once
 * it is there.
 */
export const saveGameToAccount = async (
  text: string,
  title: string
): Promise<boolean> => {
  const parsed = parseContinuationHandoffText(text);
  if (!parsed.ok) return false;
  try {
    await request(`/v2/account/saves/${parsed.value.saveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title }),
    });
  } catch {
    return false;
  }
  toast({
    title: t`Saved to your account`,
    tone: 'success',
    id: 'account-save',
  });
  changed();
  return true;
};

const listeners = new Set<() => void>();
const changed = (): void => {
  for (const listener of [...listeners]) listener();
};

/** The account's saves while shown; `undefined` until read. */
export const useAccountSaves = (): {
  readonly saves: readonly AccountSave[] | undefined;
  readonly remove: (id: string) => void;
} => {
  const { account } = useAccount();
  const [saves, setSaves] = useState<readonly AccountSave[] | undefined>();
  const accountId = account?.id;
  useEffect(() => {
    if (!accountId) {
      setSaves(undefined);
      return;
    }
    let live = true;
    const read = () => {
      fetchAccountSaves().then(
        (found) => {
          if (live) setSaves(found);
        },
        () => {
          if (live) setSaves([]);
        }
      );
    };
    read();
    listeners.add(read);
    return () => {
      live = false;
      listeners.delete(read);
    };
  }, [accountId]);
  const remove = useCallback((id: string) => {
    setSaves((current) => current?.filter((save) => save.id !== id));
    void removeAccountSave(id).catch(() => undefined);
  }, []);
  return { saves, remove };
};
