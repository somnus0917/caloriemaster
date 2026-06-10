// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth } from "../src/hooks/useAuth";

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("useAuth", () => {
  it("starts in 'loading' and resolves to 'unauthenticated' when /api/auth/me returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "no" } }, 401),
    );
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(result.current.user).toBeNull();
  });

  it("resolves to 'authenticated' when /api/auth/me returns a user", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ user: { id: "u1", email: "a@b.com", username: null, createdAt: "x" } }),
    );
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.user?.email).toBe("a@b.com");
  });

  it("login() updates the auth state on success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHENTICATED", message: "" } }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ user: { id: "u1", email: "a@b.com", username: null, createdAt: "x" } }),
      );
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    await act(async () => {
      await result.current.login("a@b.com", "password1234");
    });
    expect(result.current.status).toBe("authenticated");
    expect(result.current.user?.email).toBe("a@b.com");
  });

  it("login() surfaces server error messages", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "INVALID_CREDENTIALS", message: "邮箱或密码错误" } }, 401),
      );
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    let err: { message?: string } = {};
    await act(async () => {
      try {
        await result.current.login("a@b.com", "wrongpassword1");
      } catch (e) {
        err = e as { message?: string };
      }
    });
    expect(err.message).toMatch(/邮箱或密码错误/);
    expect(result.current.status).toBe("unauthenticated");
  });

  it("logout() clears the user and posts /api/auth/logout", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { id: "u1", email: "a@b.com", username: null, createdAt: "x" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/logout");
  });
});
