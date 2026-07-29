import bcrypt from 'bcryptjs';
import prisma from './utils/db.js';

// Isolated provisioning script for the platform's most privileged account.
// Deliberately kept separate from seed.ts (which seeds unrelated demo data)
// and never hardcodes credentials — always sourced from env.
async function main() {
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || '';
  const name = process.env.SUPERADMIN_NAME || 'Superadmin';

  if (!email || !password) {
    console.error('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set in the environment.');
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('SUPERADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const superAdmin = await prisma.superAdmin.upsert({
    where: { email },
    update: { password: hashedPassword, name },
    create: { email, password: hashedPassword, name },
  });

  console.log(`Superadmin ready: ${superAdmin.email}`);
}

main()
  .catch((error) => {
    console.error('Superadmin seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
