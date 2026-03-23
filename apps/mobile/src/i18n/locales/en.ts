export default {
  auth: {
    common: {
      continueWithGoogle: 'Continue with Google',
      orDivider: 'or',
      socialEmailConflict:
        'This email is already registered. Please sign in with your email and password.',
      invalidGoogleToken: 'Google sign-in failed. Please try again.',
      googleEmailMissing:
        'Your Google account has no email address. Please use email sign-in.',
      invalidAppleToken: 'Apple sign-in failed. Please try again.',
      appleEmailMissing:
        'Your Apple account has no email address. Please use email sign-in.',
    },
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
