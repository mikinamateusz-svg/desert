export default {
  auth: {
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
  },
} as const;
