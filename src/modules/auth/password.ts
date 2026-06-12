import { hash, verify } from "@node-rs/argon2";

import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
} from "./constants";

// The package declares Algorithm as an ambient const enum, which is
// incompatible with isolatedModules. Its Argon2id wire value is 2.
const ARGON2ID_ALGORITHM = 2;

export function validatePasswordStrength(password: string) {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error("Password must be at least 12 characters");
  }

  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    throw new Error("Password must be at most 1024 characters");
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
