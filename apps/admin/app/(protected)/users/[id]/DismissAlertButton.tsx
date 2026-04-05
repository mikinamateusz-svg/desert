'use client';

import { useState, useTransition } from 'react';
import { dismissAlert } from '../actions';

interface DismissAlertButtonProps {
  userId: string;
  alertId: string;
  label: string;
}

export function DismissAlertButton({ userId, alertId, label }: DismissAlertButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDismiss() {
    setError(null);
    startTransition(async () => {
      const result = await dismissAlert(userId, alertId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <>
      <button
        onClick={handleDismiss}
        disabled={isPending}
        className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-50"
      >
        {isPending ? '…' : label}
      </button>
      {error && <span className="ml-2 text-xs text-red-500">{error}</span>}
    </>
  );
}
