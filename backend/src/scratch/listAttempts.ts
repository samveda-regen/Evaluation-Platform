import prisma from '../utils/db.js';
async function main() {
  const attempts = await prisma.testAttempt.findMany({
    where: { status: { not: 'in_progress' } },
    include: { candidate: { select: { email: true } } },
    orderBy: { submittedAt: 'desc' },
    take: 15,
  });
  for (const a of attempts) {
    console.log(a.id, a.candidate.email, 'score=' + a.score, a.status);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
