export default {
  auth: {
    common: {
      continueWithGoogle: 'Kontynuuj z Google',
      orDivider: 'lub',
      socialEmailConflict:
        'Ten adres e-mail jest już zarejestrowany. Zaloguj się przy użyciu e-maila i hasła.',
      invalidGoogleToken: 'Logowanie przez Google nie powiodło się. Spróbuj ponownie.',
      googleEmailMissing:
        'Twoje konto Google nie ma adresu e-mail. Użyj logowania przez e-mail.',
      invalidAppleToken: 'Logowanie przez Apple nie powiodło się. Spróbuj ponownie.',
      appleEmailMissing:
        'Twoje konto Apple nie ma adresu e-mail. Użyj logowania przez e-mail.',
      genericSignInError: 'Logowanie nie powiodło się. Spróbuj ponownie.',
    },
    register: {
      title: 'Utwórz konto',
      emailLabel: 'E-mail',
      passwordLabel: 'Hasło',
      displayNameLabel: 'Nazwa wyświetlana',
      submitButton: 'Utwórz konto',
      loginLink: 'Masz już konto? Zaloguj się',
      emailAlreadyExists: 'Ten adres e-mail jest już zarejestrowany',
      genericError: 'Coś poszło nie tak. Spróbuj ponownie.',
    },
    login: {
      title: 'Zaloguj się',
      emailLabel: 'E-mail',
      passwordLabel: 'Hasło',
      submitButton: 'Zaloguj się',
      registerLink: 'Nie masz konta? Utwórz je',
      wrongCredentials: 'Nieprawidłowy adres e-mail lub hasło',
      genericError: 'Coś poszło nie tak. Spróbuj ponownie.',
    },
    onboarding: {
      title: 'Śledź swoje oszczędności',
      subtitle: 'Zobacz, która stacja w pobliżu jest najtańsza.',
      useEmail: 'Użyj e-maila',
      skip: 'Pomiń',
    },
    gate: {
      title: 'Twoje zdjęcie jest gotowe do wysłania',
      subtitle: 'Utwórz bezpłatne konto, aby dodawać ceny i śledzić oszczędności.',
      useEmail: 'Użyj e-maila',
      discard: 'Odrzuć i wróć',
    },
  },
} as const;
