import axios, { isAxiosError } from "axios";
import type { User } from "./types";

const SESSION_KEY = "edupredict.session";

export interface Session {
  token: string;
  expiresAt: number;
  user: User;
}

// sessionStorage: the login ends with the browser tab, which suits shared school computers.
export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.token || session.expiresAt <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be blocked. The login then simply lasts until the page reloads.
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? "/api" });

api.interceptors.request.use((config) => {
  const session = loadSession();
  if (session) config.headers.set("Authorization", `Bearer ${session.token}`);
  return config;
});

api.interceptors.response.use(undefined, (error) => {
  // A wrong password also gets a 401, and must not read as an expired session.
  const isLogin = error.config?.url?.includes("/auth/login");
  if (error.response?.status === 401 && !isLogin) onUnauthorized();
  return Promise.reject(error);
});

/** The clearest message available for any failed request. */
export function errorMessage(error: unknown): string {
  if (!isAxiosError(error)) return "Something went wrong. Please try again.";
  if (!error.response) return "Cannot reach the server. Check your connection and try again.";
  const detail = error.response.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((item: { msg?: string }) => (item.msg ?? "Invalid value.").replace(/^Value error, /, ""))
      .join(" ");
  }
  return "Something went wrong. Please try again.";
}

/** Fetch with the auth header, then hand the response to the browser as a file. */
export async function downloadFile(
  url: string,
  params: Record<string, unknown>,
  fallbackName: string,
): Promise<void> {
  const response = await api.get<Blob>(url, { params, responseType: "blob" });
  const header = String(response.headers["content-disposition"] ?? "");
  const name = /filename="([^"]+)"/.exec(header)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

/** Drop empty filter values so they never reach the query string. */
export function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
}
