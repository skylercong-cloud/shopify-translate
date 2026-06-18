import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createAuthRepository } from "@/db/repositories/auth-repository";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/modules/auth/current-user";
import { createAuthService } from "@/modules/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
};

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().APP_ORIGIN), {
    status: 303,
  });
}

function readPassword(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
}

function parsePasswordForm(formData: FormData): PasswordForm | null {
  const currentPassword = readPassword(formData, "currentPassword");
  const newPassword = readPassword(formData, "newPassword");
  const confirmPassword = readPassword(formData, "confirmPassword");

  if (!currentPassword || !newPassword || newPassword !== confirmPassword) {
    return null;
  }

  return {
    currentPassword,
    newPassword,
  };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectTo("/login");
  }

  try {
    const form = parsePasswordForm(await request.formData());
    if (!form) {
      return redirectTo("/admin?password=invalid");
    }

    const admin = await createAuthService(
      createAuthRepository(db),
    ).changeAdminPassword(form.currentPassword, form.newPassword);

    if (!admin) {
      return redirectTo("/admin?password=invalid");
    }
  } catch {
    return redirectTo("/admin?password=invalid");
  }

  const response = redirectTo("/login?password=updated");
  response.cookies.delete(SESSION_COOKIE_NAME);

  return response;
}
