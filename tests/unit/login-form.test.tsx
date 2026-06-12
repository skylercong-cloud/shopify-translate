import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/app/login/login-form";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace,
    refresh,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
  refresh.mockReset();
});

function submitPassword(password = "candidate password") {
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: password },
  });
  fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form")!);
}

describe("LoginForm", () => {
  it("renders the Chinese single-user login interface", () => {
    render(<LoginForm />);

    expect(screen.getByText("个人文档工具")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("shows a credential error for a 401 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    render(
      <StrictMode>
        <LoginForm />
      </StrictMode>,
    );

    submitPassword();

    expect(await screen.findByRole("alert")).toHaveTextContent("密码不正确");
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
  });

  it("shows a generic error for other non-success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );
    render(<LoginForm />);

    submitPassword();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "登录失败，请稍后重试",
    );
  });

  it("sends only one request for rapid duplicate submissions", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(response);
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginForm />);

    submitPassword();
    fireEvent.submit(screen.getByRole("button").closest("form")!);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse(new Response(null, { status: 401 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("密码不正确");
  });

  it("aborts the pending request when the component unmounts", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const { unmount } = render(<LoginForm />);

    submitPassword();
    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
