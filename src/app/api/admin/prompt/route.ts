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

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
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
    ).activatePrompt({
      systemPrompt: readText(formData, "systemPrompt"),
      userPromptTemplate: readText(formData, "userPromptTemplate"),
    });
  } catch {
    return redirectTo("/admin?prompt=invalid");
  }

  return redirectTo("/admin?prompt=updated");
}
