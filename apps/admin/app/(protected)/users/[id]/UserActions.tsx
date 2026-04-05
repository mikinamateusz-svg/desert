'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { shadowBanUser, unbanUser } from '../actions';

interface UserActionsProps {
  userId: string;
  isBanned: boolean;
  confirmBanLabel: string;
  confirmUnbanLabel: string;
  shadowBanLabel: string;
  removeBanLabel: string;
}

export function UserActions({
  userId,
  isBanned,
  confirmBanLabel,
  confirmUnbanLabel,
  shadowBanLabel,
  removeBanLabel,
}: UserActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleBan() {
    if (!confirm(confirmBanLabel)) return;
    setError(null);
    startTransition(async () => {
      const result = await shadowBanUser(userId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function handleUnban() {
    if (!confirm(confirmUnbanLabel)) return;
    setError(null);
    startTransition(async () => {
      const result = await unbanUser(userId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      {isBanned ? (
        <button
          onClick={handleUnban}
          disabled={isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
        >
          {isPending ? 'Working…' : removeBanLabel}
        </button>
      ) : (
        <button
          onClick={handleBan}
          disabled={isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
        >
          {isPending ? 'Working…' : shadowBanLabel}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
