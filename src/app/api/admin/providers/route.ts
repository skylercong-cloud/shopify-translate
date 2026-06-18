import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/modules/auth/current-user";
import {
  createTranslationConfigService,
  type TranslationProvider,
} from "@/modules/translation/config-service";
import { decodeMasterKey } from "@/modules/translation/encryption";

type ProviderForm = {
  provider: TranslationProvider;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
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

function parseProvider(value: string): TranslationProvider {
  if (value !== "deepseek" && value !== "qwen") {
    throw new Error("Provider is invalid");
  }

  return value;
}

function parseProviderForm(formData: FormData): ProviderForm {
  const baseUrl = readText(formData, "baseUrl");

  return {
    provider: parseProvider(readText(formData, "provider")),
    modelId: readText(formData, "modelId"),
    apiKey: readText(formData, "apiKey"),
    ...(baseUrl ? { baseUrl } : {}),
    enabled: formData.has("enabled"),
  };
}

function getModelMasterKey() {
  return decodeMasterKey(process.env.MODEL_KEY_ENCRYPTION_KEY ?? "");
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectTo("/login");
  }

  try {
    const formData = await request.formData();
    const provider = parseProviderForm(formData);
    await createTranslationConfigService(
      createTranslationConfigRepository(db),
    ).configureProvider(provider, getModelMasterKey());
  } catch {
    return redirectTo("/admin?providers=invalid");
  }

  return redirectTo("/admin?providers=updated");
}
