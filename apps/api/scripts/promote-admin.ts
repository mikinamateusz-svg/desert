/**
 * promote-admin — elevates a user to the ADMIN role by email.
 *
 * Usage:
 *   pnpm promote-admin --email=user@example.com
 *
 * Idempotent: re-running on an already-ADMIN user is a no-op.
 * Requires DATABASE_URL to be set in the environment.
 */
import { PrismaClient, UserRole } from '@desert/db';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  if (!emailArg) {
    console.error('Usage: pnpm promote-admin --email=<email>');
    process.exit(1);
  }

  const email = emailArg.split('=').slice(1).join('=').trim();
  if (!email) {
    console.error('Error: email value is empty.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`Error: no user found with email "${email}".`);
      process.exit(1);
    }

    if (user.role === UserRole.ADMIN) {
      console.log(`No change — ${email} is already ADMIN.`);
      return;
    }

    await prisma.user.update({ where: { email }, data: { role: UserRole.ADMIN } });
    console.log(`Success — ${email} promoted to ADMIN.`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
