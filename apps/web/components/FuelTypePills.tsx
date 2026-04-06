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
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-1.5 py-1.5 rounded-full bg-gray-900/80 backdrop-blur-sm shadow-lg">
      {FUEL_TYPES.map(ft => (
        <button
          key={ft}
          onClick={() => onChange(ft)}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
            selected === ft
              ? 'bg-white text-gray-900'
              : 'text-white hover:bg-white/15 active:bg-white/20'
          }`}
        >
          {t.fuelTypes[ft]}
        </button>
      ))}
    </div>
  );
}
