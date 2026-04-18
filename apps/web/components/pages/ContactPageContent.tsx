'use client';

import { useState } from 'react';
import type { Locale, Translations } from '../../lib/i18n';
import Footer from '../Footer';

interface Props {
  locale: Locale;
  t: Translations;
}

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? process.env['INTERNAL_API_URL'] ?? '';

export default function ContactPageContent({ locale, t }: Props) {
  const c = t.contact;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch(`${API_BASE}/v1/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message }),
      });
      if (res.ok) {
        setStatus('success');
        setName('');
        setEmail('');
        setSubject('');
        setMessage('');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <>
      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-10 lg:py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{c.title}</h1>
        <p className="text-gray-500 mb-10">{c.subtitle}</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="lg:col-span-2">
            {status === 'success' ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <h2 className="text-lg font-semibold text-green-800 mb-2">{c.successTitle}</h2>
                <p className="text-sm text-green-700">{c.successMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{c.name}</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{c.email}</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{c.subject}</label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{c.message}</label>
                  <textarea
                    required
                    rows={6}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent resize-none"
                  />
                </div>
                {status === 'error' && (
                  <p className="text-sm text-red-600">{c.errorMsg}</p>
                )}
                <button
                  type="submit"
                  disabled={status === 'sending'}
                  className="bg-brand-ink text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-brand-ink-hover transition-colors disabled:opacity-60"
                >
                  {status === 'sending' ? c.sending : c.send}
                </button>
              </form>
            )}
          </div>

          {/* Info */}
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">{c.infoTitle}</h2>
              <a href={`mailto:${c.infoEmail}`} className="text-sm text-brand-accent hover:underline">
                {c.infoEmail}
              </a>
              <p className="text-xs text-gray-400 mt-2">{c.infoResponse}</p>
            </div>
          </div>
        </div>
      </div>
      <Footer locale={locale} t={t} />
    </>
  );
}
