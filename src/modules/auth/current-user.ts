import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";

import { SESSION_COOKIE_NAME } from "./constants";
import { hashSessionToken } from "./session";
import type { SessionRepository } from "./types";
export async function getUserForSessionToken(
  repository: SessionRepository,
  token: string,
  now = new Date(),
) {
  const session = await repository.findSessionByTokenHash(
    hashSessionToken(token),
  );

  if (!session || session.expiresAt <= now) {
    return null;
  }

  return session.user;
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return getUserForSessionToken(createAuthRepository(db), token);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
