/**
 * change-password — sets a new password for an existing user, by email.
 *
 * Usage:
 *   pnpm change-password --email=user@example.com --password='<new-password>'
 *
 * Looks up the user in Postgres (by email), reads supertokens_id, then calls
 * SuperTokens core to update the password. Idempotent — safe to re-run.
 *
 * Required env vars:
 *   DATABASE_URL                 — Postgres connection string for the target env
 *   SUPERTOKENS_CONNECTION_URI   — SuperTokens core URL for the target env
 *   SUPERTOKENS_API_KEY          — SuperTokens core API key for the target env
 *
 * IMPORTANT: prod and staging have separate SuperTokens instances. Pick env
 * vars matching the env where you want the password changed.
 */
import SuperTokens, { RecipeUserId } from 'supertokens-node';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import Session from 'supertokens-node/recipe/session/index.js';
import ThirdParty from 'supertokens-node/recipe/thirdparty/index.js';
import { prisma } from '@desert/db';

// Inlined from src/auth/supertokens.ts so the script lives entirely outside src/ —
// avoids ts-node rootDir resolution issues when crossing the src/scripts boundary.
function initSuperTokensForScript(connectionUri: string, apiKey: string): void {
  SuperTokens.init({
    framework: 'custom',
    supertokens: { connectionURI: connectionUri, apiKey },
    appInfo: {
      appName: 'desert',
      apiDomain: process.env['API_URL'] ?? 'http://localhost:3000',
      websiteDomain: process.env['WEB_URL'] ?? 'http://localhost:3001',
      apiBasePath: '/v1/auth',
    },
    recipeList: [
      ThirdParty.init(),
      EmailPassword.init(),
      Session.init({ getTokenTransferMethod: () => 'header' }),
    ],
  });
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!process.env.SUPERTOKENS_CONNECTION_URI || !process.env.SUPERTOKENS_API_KEY) {
    console.error('Error: SUPERTOKENS_CONNECTION_URI and SUPERTOKENS_API_KEY must be set.');
    process.exit(1);
  }

  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  const passwordArg = process.argv.find((a) => a.startsWith('--password='));
  if (!emailArg || !passwordArg) {
    console.error("Usage: pnpm change-password --email=<email> --password='<new-password>'");
    process.exit(1);
  }

  const email = emailArg.split('=').slice(1).join('=').trim();
  const password = passwordArg.split('=').slice(1).join('='); // do NOT trim — passwords may legitimately have edge whitespace
  if (!email || !password) {
    console.error('Error: --email and --password values must be non-empty.');
    process.exit(1);
  }

  initSuperTokensForScript(
    process.env.SUPERTOKENS_CONNECTION_URI,
    process.env.SUPERTOKENS_API_KEY,
  );

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, supertokens_id: true, email: true },
    });
    if (!user) {
      console.error(`Error: no user found with email "${email}".`);
      process.exit(1);
    }

    if (!user.supertokens_id) {
      // Social-only users (Google/Apple) may not have a SuperTokens emailpassword identity.
      console.error(`Error: user "${email}" has no supertokens_id — likely a social-only account; password change not applicable.`);
      process.exit(1);
    }

    // SuperTokens uses recipeUserId for password updates. The supertokens_id
    // stored in our User row IS the user's SuperTokens primary user ID, which
    // for emailpassword users with no account-linking is also the recipeUserId.
    const result = await EmailPassword.updateEmailOrPassword({
      recipeUserId: new RecipeUserId(user.supertokens_id),
      password,
    });

    if (result.status === 'OK') {
      console.log(`Success — password updated for ${email}.`);
      return;
    }
    if (result.status === 'PASSWORD_POLICY_VIOLATED_ERROR') {
      console.error(`Error: password rejected — ${result.failureReason}`);
      process.exit(1);
    }
    if (result.status === 'UNKNOWN_USER_ID_ERROR') {
      console.error(`Error: SuperTokens has no user with id ${user.supertokens_id}.`);
      process.exit(1);
    }
    console.error(`Error: SuperTokens returned ${result.status}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
