export default {
  auth: {
    register: {
      title: 'Create account',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      displayNameLabel: 'Display name',
      submitButton: 'Create account',
      loginLink: 'Already have an account? Sign in',
      emailAlreadyExists: 'This email is already registered',
      genericError: 'Something went wrong. Please try again.',
    },
    login: {
      title: 'Sign in',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submitButton: 'Sign in',
      registerLink: "Don't have an account? Create one",
      wrongCredentials: 'Invalid email or password',
      genericError: 'Something went wrong. Please try again.',
    },
  },
} as const;
