import type { Locale, Translations } from '../../lib/i18n';
import { LitroWordmark } from '../LitroWordmark';

interface Props {
  locale: Locale;
  t: Translations;
}

// Swap these for real store URLs once the app is live in the stores
const APP_STORE_URL = '#';
const GOOGLE_PLAY_URL = '#';

export default function DownloadPageContent({ t }: Props) {
  const { title, subtitle, appStore, googlePlay, comingSoon } = t.download;

  return (
    <main className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 py-16 text-center bg-[#f4f4f4]">
      <div className="mb-8">
        <LitroWordmark height={36} />
      </div>

      <span className="inline-block bg-amber-500 text-[#1a1a1a] text-xs font-bold px-3 py-1 rounded-full mb-4 tracking-wide">
        {comingSoon}
      </span>
      <h1 className="text-3xl font-bold text-[#1a1a1a] mb-3">{title}</h1>
      <p className="text-[#6b7280] text-lg max-w-sm mb-10">{subtitle}</p>

      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        {/* App Store badge */}
        <a
          href={APP_STORE_URL}
          className="flex items-center gap-3 bg-[#1a1a1a] text-white px-6 py-3.5 rounded-xl hover:bg-[#2a2a2a] transition-colors min-w-[200px]"
          aria-label={appStore}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7 flex-shrink-0" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
          </svg>
          <div className="text-left">
            <div className="text-xs opacity-75 leading-none mb-0.5">Download on the</div>
            <div className="text-base font-semibold leading-none">App Store</div>
          </div>
        </a>

        {/* Google Play badge */}
        <a
          href={GOOGLE_PLAY_URL}
          className="flex items-center gap-3 bg-[#1a1a1a] text-white px-6 py-3.5 rounded-xl hover:bg-[#2a2a2a] transition-colors min-w-[200px]"
          aria-label={googlePlay}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7 flex-shrink-0" fill="currentColor">
            <path d="M3 20.5v-17c0-.83.94-1.3 1.6-.8l14 8.5c.6.36.6 1.24 0 1.6l-14 8.5c-.66.5-1.6.03-1.6-.8z" />
          </svg>
          <div className="text-left">
            <div className="text-xs opacity-75 leading-none mb-0.5">Get it on</div>
            <div className="text-base font-semibold leading-none">Google Play</div>
          </div>
        </a>
      </div>

    </main>
  );
}
