'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { retryDlqJob, discardDlqJob } from './actions';

interface DlqRowActionsProps {
  jobId: string;
  retryLabel: string;
  discardLabel: string;
  confirmDiscardLabel: string;
  errorLabel: string;
}

export function DlqRowActions({
  jobId,
  retryLabel,
  discardLabel,
  confirmDiscardLabel,
}: DlqRowActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleRetry() {
    setError(null);
    startTransition(async () => {
      const result = await retryDlqJob(jobId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function handleDiscard() {
    if (!confirm(confirmDiscardLabel)) return;
    setError(null);
    startTransition(async () => {
      const result = await discardDlqJob(jobId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRetry}
        disabled={isPending}
        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? '…' : retryLabel}
      </button>
      <button
        onClick={handleDiscard}
        disabled={isPending}
        className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {isPending ? '…' : discardLabel}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
