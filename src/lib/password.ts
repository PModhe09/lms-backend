import bcrypt from 'bcryptjs';

const COST = 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

/**
 * Compared against when the email does not exist, so "unknown email" and "wrong password"
 * take the same time and an attacker cannot enumerate accounts by timing.
 */
export const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', COST);
