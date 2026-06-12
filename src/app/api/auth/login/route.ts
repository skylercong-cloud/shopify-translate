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
import { loginRateLimit } from "@/modules/auth/login-rate-limit";

const bodySchema = z.object({
  password: z.string().min(1).max(MAXIMUM_PASSWORD_LENGTH),
});

async function parsePassword(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return null;
  }

  return parsed.data.password;
}

async function authenticate(password: string) {
  const service = createAuthService(createAuthRepository(db));
  const session = await service.login(password);

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

export async function POST(request: Request) {
  const password = await parsePassword(request);

  if (password === null) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  return loginRateLimit.runExclusive(async () => {
    const rateLimit = loginRateLimit.check();

    if (!rateLimit.allowed) {
      return Response.json(
        { error: "Too many login attempts" },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const response = await authenticate(password);

    if (response.status === 401) {
      loginRateLimit.recordFailure();
    } else if (response.status === 200) {
      loginRateLimit.reset();
    }

    return response;
  });
}
