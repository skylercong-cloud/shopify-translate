"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { MAXIMUM_PASSWORD_LENGTH } from "@/modules/auth/constants";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.get("password") }),
      });

      if (!response.ok) {
        setError("密码不正确");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <p className="eyebrow">个人文档工具</p>
      <h1>登录</h1>
      <label htmlFor="password">密码</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={MAXIMUM_PASSWORD_LENGTH}
      />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={submitting} type="submit">
        {submitting ? "正在登录..." : "登录"}
      </button>
    </form>
  );
}
