'use client';

import type { FuelType } from '@desert/types';
import type { Translations } from '../lib/i18n';

export const FUEL_TYPES: FuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

interface Props {
  selected: FuelType;
  onChange: (ft: FuelType) => void;
  t: Translations;
}

export default function FuelTypePills({ selected, onChange, t }: Props) {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-0">
      {FUEL_TYPES.map(ft => (
        <button
          key={ft}
          onClick={() => onChange(ft)}
          className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all whitespace-nowrap border ${
            selected === ft
              ? 'bg-amber-500 border-amber-500 text-[#1a1a1a]'
              : 'bg-black/85 border-white/15 text-white hover:bg-black/70'
          }`}
        >
          {t.fuelTypes[ft]}
        </button>
      ))}
    </div>
  );
}
