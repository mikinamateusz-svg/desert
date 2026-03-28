interface Props {
  slotId: string;
  className?: string;
  label?: string;
}

/**
 * Ad slot placeholder. Replace the inner div contents with real ad network
 * code (e.g. Google Ad Manager GPT tag) when ads are integrated.
 * slotId maps to your ad network's slot identifier.
 */
export default function AdSlot({ slotId, className = '', label = 'Reklama' }: Props) {
  return (
    <div
      className={`flex items-center justify-center border border-dashed border-gray-200 bg-gray-50 rounded-lg text-xs text-gray-400 select-none ${className}`}
      data-slot-id={slotId}
      aria-hidden="true"
    >
      {label}
    </div>
  );
}
