"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { MAXIMUM_PASSWORD_LENGTH } from "@/modules/auth/constants";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestInFlight = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;

    requestInFlight.current = true;
    setSubmitting(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.get("password") }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (mounted.current) {
          setError(
            response.status === 401
              ? "密码不正确"
              : "登录失败，请稍后重试",
          );
        }
        return;
      }

      if (mounted.current) {
        router.replace("/");
        router.refresh();
      }
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        setError("登录失败，请稍后重试");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        requestInFlight.current = false;
      }
      if (mounted.current) {
        setSubmitting(false);
      }
    }
  }

  return (
    <form className="login-card" method="post" onSubmit={submit}>
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
