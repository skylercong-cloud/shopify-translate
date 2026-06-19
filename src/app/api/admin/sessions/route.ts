import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { hashSessionToken } from "@/modules/auth/session";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().APP_ORIGIN), {
    status: 303,
  });
}

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return redirectTo("/login");
  }

  const currentTokenHash = hashSessionToken(token);
  const repository = createAuthRepository(db);
  const session = await repository.findSessionByTokenHash(currentTokenHash);

  if (!session || session.expiresAt <= new Date()) {
    return redirectTo("/login");
  }

  await repository.deleteOtherSessionsForUser(
    session.user.id,
    currentTokenHash,
  );

  return redirectTo("/admin?sessions=revoked");
}
