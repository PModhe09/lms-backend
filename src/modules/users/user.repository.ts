import type { ClientSession } from 'mongoose';
import { OnboardingStage, Role } from '../../domain/enums.ts';
import { ConflictError } from '../../domain/errors.ts';
import { isDuplicateKeyError } from '../../infra/mongo.ts';
import { UserModel, type User, type UserDocument } from '../../infra/models/user.model.ts';
import type { Page, PageQuery } from '../shared/http.ts';

export class UserRepository {
  findById(id: string, session?: ClientSession): Promise<UserDocument | null> {
    return UserModel.findById(id)
      .session(session ?? null)
      .exec();
  }

  /** The only read that loads `passwordHash`. */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email }).select('+passwordHash').exec();
  }

  async createBorrower(email: string, passwordHash: string): Promise<UserDocument> {
    try {
      return await UserModel.create({
        email,
        passwordHash,
        role: Role.BORROWER,
        onboardingStage: OnboardingStage.REGISTERED,
      });
    } catch (err) {
      if (isDuplicateKeyError(err))
        throw new ConflictError('EMAIL_TAKEN', 'An account with this email already exists');
      throw err;
    }
  }

  async saveProfile(
    id: string,
    patch: {
      borrowerProfile: NonNullable<User['borrowerProfile']>;
      breResult: Omit<NonNullable<User['breResult']>, 'failures'> & {
        failures: { rule: string; message: string }[];
      };
      onboardingStage: OnboardingStage;
    },
  ): Promise<UserDocument> {
    try {
      const user = await UserModel.findByIdAndUpdate(
        id,
        { $set: patch },
        { new: true, runValidators: true },
      ).exec();
      if (!user) throw new Error(`user ${id} vanished`);
      return user;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('PAN_TAKEN', 'This PAN is already registered to another account');
      }
      throw err;
    }
  }

  async saveSalarySlip(id: string, salarySlip: NonNullable<User['salarySlip']>): Promise<UserDocument> {
    const user = await UserModel.findByIdAndUpdate(
      id,
      { $set: { salarySlip, onboardingStage: OnboardingStage.SLIP_UPLOADED } },
      { new: true },
    ).exec();
    if (!user) throw new Error(`user ${id} vanished`);
    return user;
  }

  async setStage(id: string, stage: OnboardingStage, session?: ClientSession): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $set: { onboardingStage: stage } }, { session }).exec();
  }

  /** Borrowers who have not applied: the Sales pipeline. */
  async listLeads(
    stage: OnboardingStage | undefined,
    { page, limit }: PageQuery,
  ): Promise<Page<UserDocument>> {
    const filter = { role: Role.BORROWER, onboardingStage: stage ?? { $ne: OnboardingStage.APPLIED } };
    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      UserModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }
}
