import { useLingui } from '@lingui/react/macro';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isInputMethodKey } from '../ui/input-method.js';
import { Tooltip } from '../ui/Tooltip.js';

/**
 * A seat's name at the head of its hand's pill (2026-11-12, the owner's
 * choice: names on the table, out of Settings). Where the viewer may rename
 * the seat (both at a Solo table, their own in a room) it is a button that
 * turns into a field in place: Enter or leaving it saves, Esc puts the name
 * back. A save the room refuses keeps what was typed, marked, for the next
 * press to try again; an older save's answer never overwrites a newer
 * draft. Elsewhere (a spectator, a replay) it is the name alone.
 */
export const TableSeatName = ({
  name,
  editable,
  onRename,
  side,
}: {
  readonly name: string;
  /** The viewer may rename this seat here and now. */
  readonly editable: boolean;
  /** Saves a name: false, or a rejection, when the room refused it. */
  readonly onRename?: (name: string) => void | boolean | Promise<boolean>;
  /** Where its hint shows: away from the table's edge. */
  readonly side: 'top' | 'bottom';
}) => {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [failed, setFailed] = useState(false);
  // A saved name shows while the room takes it, rather than the old one.
  const [saving, setSaving] = useState<string | undefined>(undefined);
  const dirty = useRef(false);
  const version = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Enter and Esc hand the keyboard back to the name; a press elsewhere
  // keeps it where it went.
  const refocus = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // An untouched draft follows the name as it changes.
  useEffect(() => {
    if (!dirty.current) setDraft(name);
    if (pending.current === undefined) setSaving(undefined);
  }, [name]);
  // Taken out of the viewer's hands (a replay, the room closing), the field
  // closes; a draft not yet saved waits for it to come back.
  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);
  useLayoutEffect(() => {
    if (editing) {
      field.current?.focus();
      field.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      // A touch screen's keyboard simply closes: its hint would only stay.
      if (!globalThis.matchMedia?.('(hover: none)').matches) {
        button.current?.focus();
      }
    }
  }, [editing]);

  if (!editable) {
    return (
      <span className="table-hand-pill__name" data-seat-name="shown">
        {name}
      </span>
    );
  }

  const save = (): void => {
    setEditing(false);
    if (!dirty.current) return;
    dirty.current = false;
    const attempt = ++version.current;
    const value = draft.replace(/\s+/gu, ' ').trim();
    setFailed(false);
    if (!value) {
      setDraft(name);
      return;
    }
    setDraft(value);
    setSaving(value);
    pending.current = attempt;
    const settle = (accepted: boolean): void => {
      if (!mounted.current || version.current !== attempt) return;
      pending.current = undefined;
      setSaving(undefined);
      if (accepted) return;
      dirty.current = true;
      setFailed(true);
    };
    try {
      void Promise.resolve(onRename?.(value))
        .then((accepted) => settle(accepted !== false))
        .catch(() => settle(false));
    } catch {
      settle(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={field}
        className="table-hand-pill__name table-hand-pill__name-field"
        data-seat-name="field"
        aria-label={t`Name for ${name}`}
        aria-invalid={failed ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        maxLength={64}
        size={Math.max(4, Math.min(16, [...draft].length + 1))}
        value={draft}
        onChange={(event) => {
          dirty.current = true;
          version.current += 1;
          setFailed(false);
          setDraft(event.target.value);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (isInputMethodKey(event.nativeEvent)) return;
          if (event.key === 'Enter') {
            // Kept from the name it hands the keyboard back to, which the
            // key would otherwise press, opening the field again.
            event.preventDefault();
            refocus.current = true;
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            // Esc puts the name back and stops there: nothing else closes.
            event.stopPropagation();
            dirty.current = false;
            version.current += 1;
            pending.current = undefined;
            setFailed(false);
            setSaving(undefined);
            setDraft(name);
            refocus.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }

  const shown = saving ?? name;
  return (
    <Tooltip content={t`Rename`} side={side}>
      <button
        ref={button}
        type="button"
        className="table-hand-pill__name"
        data-seat-name="rename"
        data-failed={failed ? 'true' : undefined}
        aria-label={t`Rename ${shown}`}
        onClick={() => {
          if (!dirty.current) setDraft(shown);
          setEditing(true);
        }}
      >
        {shown}
      </button>
    </Tooltip>
  );
};
