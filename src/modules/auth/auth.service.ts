import { UnauthenticatedError } from '../../domain/errors.ts';
import type { UserDocument } from '../../infra/models/user.model.ts';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.ts';
import type { AuthUser, LoginBody, SignupBody } from './auth.schemas.ts';
import type { UserRepository } from '../users/user.repository.ts';

export function toAuthUser(user: UserDocument): AuthUser {
  return {
    id: user.id as string,
    email: user.email,
    role: user.role,
    ...(user.onboardingStage ? { onboardingStage: user.onboardingStage } : {}),
  };
}

export class AuthService {
  constructor(private readonly users: UserRepository) {}

  async signup(input: SignupBody): Promise<AuthUser> {
    const user = await this.users.createBorrower(input.email, await hashPassword(input.password));
    return toAuthUser(user);
  }

  /** Same error, and roughly the same time, for "no such email" and "wrong password". */
  async login(input: LoginBody): Promise<AuthUser> {
    const user = await this.users.findByEmailWithPassword(input.email);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthenticatedError('Invalid email or password');
    return toAuthUser(user);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    // Token is valid but the account is gone: treat as logged out.
    if (!user) throw new UnauthenticatedError();
    return toAuthUser(user);
  }
}
