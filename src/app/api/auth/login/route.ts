import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { getEnv } from "@/lib/env";
import { createAuthService } from "@/modules/auth/auth-service";
import {
  MAXIMUM_PASSWORD_LENGTH,
  SESSION_COOKIE_NAME,
} from "@/modules/auth/constants";
import { sessionCookieOptions } from "@/modules/auth/cookies";

const bodySchema = z.object({
  password: z.string().min(1).max(MAXIMUM_PASSWORD_LENGTH),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const service = createAuthService(createAuthRepository(db));
  const session = await service.login(parsed.data.password);

  if (!session) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    session.token,
    sessionCookieOptions(
      getEnv().NODE_ENV === "production",
      session.expiresAt,
    ),
  );

  return response;
}
