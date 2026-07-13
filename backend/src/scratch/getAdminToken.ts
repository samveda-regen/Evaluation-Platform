import '../env.js';
import prisma from '../utils/db.js';
import { generateAdminToken } from '../utils/jwt.js';
async function main() {
  const admin = await prisma.admin.findFirst();
  if (!admin) throw new Error('no admin');
  console.log(generateAdminToken({ id: admin.id, email: admin.email, role: 'admin' }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
