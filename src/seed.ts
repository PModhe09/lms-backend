import { OnboardingStage, Role } from './domain/enums.ts';
import { UserModel } from './infra/models/user.model.ts';
import { hashPassword } from './lib/password.ts';

/** Demo accounts, published in the README on purpose. See docs/design/05-rbac.md. */
export const SEED_USERS = [
  { role: Role.ADMIN, email: 'admin@lms.dev', password: 'Admin@123' },
  { role: Role.SALES, email: 'sales@lms.dev', password: 'Sales@123' },
  { role: Role.SANCTION, email: 'sanction@lms.dev', password: 'Sanction@123' },
  { role: Role.DISBURSEMENT, email: 'disbursement@lms.dev', password: 'Disburse@123' },
  { role: Role.COLLECTION, email: 'collection@lms.dev', password: 'Collect@123' },
  { role: Role.BORROWER, email: 'borrower@lms.dev', password: 'Borrower@123' },
] as const;

/** Idempotent: upsert by email. Re-running resets passwords and roles but never touches borrower progress. */
export async function seedUsers(): Promise<void> {
  await Promise.all(
    SEED_USERS.map(async ({ role, email, password }) =>
      UserModel.updateOne(
        { email },
        {
          $set: { role, passwordHash: await hashPassword(password) },
          ...(role === Role.BORROWER
            ? { $setOnInsert: { onboardingStage: OnboardingStage.REGISTERED } }
            : {}),
        },
        { upsert: true },
      ),
    ),
  );
}
