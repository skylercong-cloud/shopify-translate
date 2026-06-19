import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/modules/auth/current-user";
import { createTranslationConfigService } from "@/modules/translation/config-service";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().APP_ORIGIN), {
    status: 303,
  });
}

function parseTerms(formData: FormData): string[] {
  const value = formData.get("terms");
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectTo("/login");
  }

  try {
    const formData = await request.formData();
    await createTranslationConfigService(
      createTranslationConfigRepository(db),
    ).activateGlossary({
      terms: parseTerms(formData),
    });
  } catch {
    return redirectTo("/admin?glossary=invalid");
  }

  return redirectTo("/admin?glossary=updated");
}
