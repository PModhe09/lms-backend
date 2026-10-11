/**
 * Removes data created by smoke-live.ts and the Playwright E2E run from a database:
 * users with emails ending in @lms.test or starting with e2e-, their loans and payments.
 *   MONGO_URI=... npx tsx scripts/smoke-cleanup.ts
 * Salary slip objects stay in storage (private, unreferenced).
 */
import mongoose from 'mongoose';

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI is required');
await mongoose.connect(uri);
const db = mongoose.connection.db!;
const users = await db
  .collection('users')
  .find(
    { role: 'BORROWER', $or: [{ email: /@lms\.test$/ }, { email: /^e2e-\d+@example\.com$/ }] },
    { projection: { _id: 1 } },
  )
  .toArray();
const ids = users.map((u) => u._id);
const loans = await db
  .collection('loans')
  .find({ borrowerId: { $in: ids } }, { projection: { _id: 1 } })
  .toArray();
const loanIds = loans.map((l) => l._id);
const p = await db.collection('payments').deleteMany({ loanId: { $in: loanIds } });
const l = await db.collection('loans').deleteMany({ _id: { $in: loanIds } });
const u = await db.collection('users').deleteMany({ _id: { $in: ids } });
console.log(`removed ${u.deletedCount} users, ${l.deletedCount} loans, ${p.deletedCount} payments`);
await mongoose.disconnect();
