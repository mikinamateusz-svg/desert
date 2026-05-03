'use client';

import { useState, useTransition } from 'react';
import { registerAction } from './actions';
import type { Translations } from '../../lib/i18n';

interface Props {
  t: Translations['register'];
}

export function RegisterForm({ t }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await registerAction(formData);
      if (res?.error === 'emailExists') setError(t.errorEmailExists);
      else if (res?.error === 'weakPassword') setError(t.errorWeakPassword);
      else if (res?.error) setError(t.errorGeneric);
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
          {t.displayNameLabel}
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          maxLength={255}
          disabled={isPending}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          {t.emailLabel}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          {t.passwordLabel}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          disabled={isPending}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {t.submitButton}
      </button>
    </form>
  );
}
