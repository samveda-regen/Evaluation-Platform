import { testGradingQueue } from '../queues/testGradingQueue.js';
async function main() {
  const failed = await testGradingQueue.getJobs(['failed'], 0, 10);
  const completed = await testGradingQueue.getJobs(['completed'], 0, 10);
  console.log('failed:', JSON.stringify(failed.map(j => ({ id: j.id, data: j.data, reason: j.failedReason, attemptsMade: j.attemptsMade })), null, 2));
  console.log('completed:', JSON.stringify(completed.map(j => ({ id: j.id, data: j.data, returnvalue: j.returnvalue })), null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
