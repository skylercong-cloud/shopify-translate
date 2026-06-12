import { hash, verify } from "@node-rs/argon2";

const MIN_PASSWORD_LENGTH = 12;
// The package declares Algorithm as an ambient const enum, which is
// incompatible with isolatedModules. Its Argon2id wire value is 2.
const ARGON2ID_ALGORITHM = 2;

export function validatePasswordStrength(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error("Password must be at least 12 characters");
  }
}

export async function hashPassword(password: string) {
  validatePasswordStrength(password);

  return hash(password, {
    algorithm: ARGON2ID_ALGORITHM,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}
