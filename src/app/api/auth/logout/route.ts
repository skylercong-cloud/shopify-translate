import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { createAuthService } from "@/modules/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await createAuthService(createAuthRepository(db)).logout(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);

  return response;
}
