export default {
  auth: {
    common: {
      continueWithGoogle: 'Продовжити з Google',
      orDivider: 'або',
      socialEmailConflict:
        'Цей email вже зареєстровано. Будь ласка, увійдіть за допомогою email та пароля.',
      invalidGoogleToken: 'Не вдалося увійти через Google. Спробуйте ще раз.',
      googleEmailMissing:
        'Ваш акаунт Google не має email-адреси. Скористайтесь входом через email.',
    },
    register: {
      title: 'Створити акаунт',
      emailLabel: 'Електронна пошта',
      passwordLabel: 'Пароль',
      displayNameLabel: 'Відображуване ім\'я',
      submitButton: 'Створити акаунт',
      loginLink: 'Вже маєте акаунт? Увійти',
      emailAlreadyExists: 'Ця електронна адреса вже зареєстрована',
      genericError: 'Щось пішло не так. Спробуйте ще раз.',
    },
    login: {
      title: 'Увійти',
      emailLabel: 'Електронна пошта',
      passwordLabel: 'Пароль',
      submitButton: 'Увійти',
      registerLink: 'Немає акаунта? Створіть його',
      wrongCredentials: 'Неправильна електронна адреса або пароль',
      genericError: 'Щось пішло не так. Спробуйте ще раз.',
    },
  },
} as const;
