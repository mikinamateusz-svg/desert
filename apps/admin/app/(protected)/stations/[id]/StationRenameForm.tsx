'use client';

import { useState, useEffect, useTransition, useId, type KeyboardEvent } from 'react';
import { renameStation } from '../actions';

interface Copy {
  editButton: string;
  saveButton: string;
  cancelButton: string;
  inputPlaceholder: string;
  errorEmpty: string;
  errorTooLong: string;
  errorUnchanged: string;
  errorGeneric: string;
  manualOverrideBadge: string;
  manualOverrideTooltip: string;
}

interface Props {
  stationId: string;
  initialName: string;
  nameManuallySetAt: string | null;
  copy: Copy;
}

const MAX_LEN = 200;

export default function StationRenameForm({
  stationId,
  initialName,
  nameManuallySetAt,
  copy,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorId = useId();

  // P4 (3.19 review) — sync the draft with the prop when the parent
  // re-renders (e.g. after revalidatePath fires post-rename). Without this,
  // the form keeps stale local state across server-driven name updates.
  useEffect(() => {
    setDraft(initialName);
  }, [initialName]);

  function clientValidate(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) return copy.errorEmpty;
    if (trimmed.length > MAX_LEN) return copy.errorTooLong;
    if (trimmed === initialName) return copy.errorUnchanged;
    return null;
  }

  function handleSave() {
    // P2 (3.19 review) — guard against double-click / rapid Enter while a
    // previous submit is in flight. `disabled={pending}` on the button
    // covers click-through but not key-driven submits.
    if (pending) return;
    const validationError = clientValidate(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameStation(stationId, draft.trim());
      if (result.error) {
        // P3 (3.19 review) — the action returns a verbatim backend message
        // (often English, e.g. "Station name cannot exceed 200 characters")
        // even when the admin's locale is PL/UK. Client validation already
        // covers all expected validation cases (empty / too long / unchanged),
        // so any error reaching this branch is unexpected — fall through to
        // the localised generic message rather than leaking English.
        setError(copy.errorGeneric);
        return;
      }
      // Server action revalidates the path; the page re-renders with the
      // new name. Close the inline form so the static <h1> shows again.
      setEditing(false);
    });
  }

  function handleCancel() {
    if (pending) return;
    setDraft(initialName);
    setError(null);
    setEditing(false);
  }

  // P6 (3.19 review) — Enter submits, Escape cancels. Standard inline-edit UX.
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }

  if (!editing) {
    return (
      <div>
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-semibold text-gray-900 break-words">{initialName}</h1>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1 shrink-0 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            {copy.editButton}
          </button>
        </div>
        {nameManuallySetAt && (
          <span
            title={copy.manualOverrideTooltip}
            aria-label={copy.manualOverrideTooltip}
            className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
          >
            {copy.manualOverrideBadge}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          maxLength={MAX_LEN}
          placeholder={copy.inputPlaceholder}
          disabled={pending}
          // P5 (3.19 review) — wire input to error message for screen readers.
          aria-invalid={error != null}
          aria-describedby={error ? errorId : undefined}
          autoFocus
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-lg text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {copy.saveButton}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          className="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {copy.cancelButton}
        </button>
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="mt-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
