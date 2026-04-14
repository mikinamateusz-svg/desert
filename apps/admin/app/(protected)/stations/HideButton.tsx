'use client';

import { useTransition } from 'react';
import { hideStation, unhideStation } from './actions';

interface Props {
  stationId: string;
  hidden: boolean;
}

export default function HideButton({ stationId, hidden }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() => startTransition(async () => { await (hidden ? unhideStation(stationId) : hideStation(stationId)); })}
      className={`text-xs px-2 py-1 rounded ${
        hidden
          ? 'bg-green-100 text-green-700 hover:bg-green-200'
          : 'bg-red-100 text-red-700 hover:bg-red-200'
      } ${isPending ? 'opacity-50' : ''}`}
    >
      {isPending ? '...' : hidden ? 'Unhide' : 'Hide'}
    </button>
  );
}
