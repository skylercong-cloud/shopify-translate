import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/modules/auth/current-user";
import { createTranslationConfigService } from "@/modules/translation/config-service";

type RuntimeSettingsForm = {
  dailyTokenLimit?: number;
  requestTimeoutMs: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  workerConcurrency: number;
};

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().APP_ORIGIN), {
    status: 303,
  });
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);

  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function parseRequiredInteger(
  formData: FormData,
  name: keyof RuntimeSettingsForm,
): number {
  return parsePositiveInteger(readText(formData, name), name);
}

function parseSettingsForm(formData: FormData): RuntimeSettingsForm {
  const dailyTokenLimit = readText(formData, "dailyTokenLimit");

  return {
    ...(dailyTokenLimit
      ? {
          dailyTokenLimit: parsePositiveInteger(
            dailyTokenLimit,
            "dailyTokenLimit",
          ),
        }
      : {}),
    requestTimeoutMs: parseRequiredInteger(
      formData,
      "requestTimeoutMs",
    ),
    maxInputBytes: parseRequiredInteger(formData, "maxInputBytes"),
    maxOutputTokens: parseRequiredInteger(formData, "maxOutputTokens"),
    workerConcurrency: parseRequiredInteger(
      formData,
      "workerConcurrency",
    ),
  };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectTo("/login");
  }

  try {
    const formData = await request.formData();
    const settings = parseSettingsForm(formData);
    await createTranslationConfigService(
      createTranslationConfigRepository(db),
    ).updateSettings(settings);
  } catch {
    return redirectTo("/admin?settings=invalid");
  }

  return redirectTo("/admin?settings=updated");
}
