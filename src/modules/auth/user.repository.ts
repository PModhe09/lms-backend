import { OnboardingStage, Role } from '../../domain/enums.ts';
import { ConflictError } from '../../domain/errors.ts';
import { isDuplicateKeyError } from '../../infra/mongo.ts';
import { UserModel, type UserDocument } from '../../infra/models/user.model.ts';

export class UserRepository {
  findById(id: string): Promise<UserDocument | null> {
    return UserModel.findById(id).exec();
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
}
