import './refuse-demo';
import { adminDb } from '../src/lib/prisma';
import { processListingOperation, recoverInterruptedOperations } from '../src/lib/ebay/listing/service';

try {
  await recoverInterruptedOperations();
  const jobs = await adminDb.listingOperation.findMany({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true } });
  for (const job of jobs) await processListingOperation(job.id);
  console.log(`Processed ${jobs.length} queued listing operation(s).`);
} finally { await adminDb.$disconnect(); }
