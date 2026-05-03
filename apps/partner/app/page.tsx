import { redirect } from 'next/navigation';

/**
 * Root entry point. Middleware redirects unauthenticated requests to
 * /login before this page even renders, so when this fires we know the
 * user is authenticated. Send them to the home dashboard.
 */
export default function HomeRedirect() {
  redirect('/home');
}
