'use client';

import { useActionState } from 'react';
import type { Translations } from '../../lib/i18n';

type LoginTranslations = Translations['login'];

interface Props {
  t: LoginTranslations;
  action: (formData: FormData) => Promise<{ error: string } | never>;
}

type State = { error: string } | null;

function getErrorMessage(t: LoginTranslations, error: string): string {
  if (error === 'invalid') return t.errorInvalid;
  if (error === 'notAdmin') return t.errorNotAdmin;
  return t.errorGeneric;
}

export default function LoginForm({ t, action }: Props) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const result = await action(formData);
      return result ?? null;
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {getErrorMessage(t, state.error)}
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          {t.emailLabel}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
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
          required
          autoComplete="current-password"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? '…' : t.submitButton}
      </button>
    </form>
  );
}
