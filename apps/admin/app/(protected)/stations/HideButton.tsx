'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { hideStation, unhideStation } from './actions';

interface Props {
  stationId: string;
  hidden: boolean;
}

export default function HideButton({ stationId, hidden }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = hidden
              ? await unhideStation(stationId)
              : await hideStation(stationId);
            if (result.error) {
              setError(result.error);
              return;
            }
            // revalidatePath inside the action invalidates the cache; an
            // explicit router.refresh() ensures the client tree re-renders
            // with the fresh `hidden` state immediately. Without it, the
            // button would keep showing "Hide" until the next navigation.
            router.refresh();
          });
        }}
        className={`text-xs px-2 py-1 rounded ${
          hidden
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-red-100 text-red-700 hover:bg-red-200'
        } ${isPending ? 'opacity-50' : ''}`}
      >
        {isPending ? '...' : hidden ? 'Unhide' : 'Hide'}
      </button>
      {error && (
        <span
          className="text-xs text-red-600 max-w-[180px] truncate"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}
