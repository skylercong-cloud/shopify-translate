import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createJobRepository } from "@/db/repositories/job-repository";
import { createTranslationConfigRepository } from "@/db/repositories/translation-config-repository";
import { createTranslationRepository } from "@/db/repositories/translation-repository";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/modules/auth/current-user";
import {
  createTranslationAdminService,
  createTranslationAdminStore,
} from "@/modules/translation/translation-admin-service";
import { normalizeCorrectionReturnTo } from "@/modules/translation/correction-return";

type CorrectionScope = "global" | "block";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().APP_ORIGIN), {
    status: 303,
  });
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
}

function parseScope(value: string): CorrectionScope {
  if (value !== "global" && value !== "block") {
    throw new Error("Correction scope is invalid");
  }

  return value;
}

function withCorrectionStatus(returnTo: string, status: "updated" | "invalid") {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}correction=${status}`;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectTo("/login");
  }

  const formData = await request.formData();
  const returnTo = normalizeCorrectionReturnTo(readText(formData, "returnTo"));

  try {
    await createTranslationAdminService({
      store: createTranslationAdminStore(db),
      translationRepository: createTranslationRepository(db),
      configRepository: createTranslationConfigRepository(db),
      jobRepository: createJobRepository(db),
      now: () => new Date(),
    }).recordManualCorrection({
      blockId: readText(formData, "blockId"),
      expectedSourceFingerprint: readText(
        formData,
        "expectedSourceFingerprint",
      ),
      scope: parseScope(readText(formData, "scope")),
      translatedText: readText(formData, "translatedText"),
    });
  } catch {
    return redirectTo(withCorrectionStatus(returnTo, "invalid"));
  }

  return redirectTo(withCorrectionStatus(returnTo, "updated"));
}
