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
      genericSignInError: 'Sign-in failed. Please try again.',
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
    onboarding: {
      title: 'Track your savings and streak',
      subtitle: 'See which station near you is cheapest right now.',
      useEmail: 'Use Email',
      skip: 'Skip',
    },
    gate: {
      title: 'Your photo is ready to submit',
      subtitle: 'Create a free account to submit prices and track your savings.',
      useEmail: 'Use Email',
      discard: 'Discard and go back',
    },
  },
  nav: {
    map: 'Map',
    activity: 'Activity',
    alerts: 'Alerts',
    account: 'Account',
  },
  submissions: {
    title: 'Activity',
    emptyTitle: 'No submissions yet',
    emptySubtitle: 'Submit a fuel price to see your history here',
    statusPending: 'Processing',
    statusRejected: 'Not published',
    stationUnknown: 'Processing...',
    loadMore: 'Load more',
    errorLoading: 'Failed to load submissions',
    retry: 'Retry',
    signInPrompt: 'Sign in to see your submission history',
  },
} as const;
