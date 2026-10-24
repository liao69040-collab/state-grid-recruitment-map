import { reactive } from "vue";

export interface AuthUser {
  phoneMasked: string;
  enabled: boolean;
}

export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
  error: string | null;
}

interface AuthResponse {
  authenticated: boolean;
  user: AuthUser;
  csrfToken: string;
  expiresAt: string;
}

interface ApiErrorBody {
  error?: string | {
    code?: string;
    message?: string;
  };
  message?: string;
}






class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const authState = reactive<AuthState>({
  ready: false,
  authenticated: false,
  user: null,
  csrfToken: null,
  error: null,
});

let bootstrapPromise: Promise<void> | null = null;
let sessionEpoch = 0;
let mutationEpoch: number | null = null;

// Requests started before login/logout cannot change a newer session.
export const getAuthSessionEpoch = () => sessionEpoch;
const beginSessionMutation = () => {
  sessionEpoch += 1;
  mutationEpoch = sessionEpoch;
  bootstrapPromise = null;
  return sessionEpoch;
};

const requestTimeoutMs = 12_000;
const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path: string) => `${apiBaseUrl}${path}`;

const normalizeError = (error: unknown, fallback = "请求失败，请稍后再试。") => {
  if (error instanceof Error && error.message) return error;
  return new Error(fallback);
};

const readError = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as ApiErrorBody;
    const message = typeof payload.error === "string"
      ? payload.error
      : payload.error?.message || payload.message;
    return new HttpError(response.status, message || fallback);
  } catch {
    return new HttpError(response.status, fallback);
  }
};

const apiFetch = async <T>(path: string, consume: (response: Response) => Promise<T>, init: RequestInit = {}): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers,
    });
    // Keep the deadline alive until the body has finished, not only headers.
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("请求超时，请检查网络后重试。");
    }
    throw normalizeError(error, "网络连接失败，请稍后再试。");
  } finally {
    window.clearTimeout(timeout);
  }
};

const applyAuthenticatedSession = (payload: AuthResponse) => {
  authState.ready = true;
  authState.authenticated = true;
  authState.user = payload.user;
  authState.csrfToken = payload.csrfToken;
  authState.error = null;
};

const applyAnonymousSession = () => {
  authState.ready = true;
  authState.authenticated = false;
  authState.user = null;
  authState.csrfToken = null;
};

// Expiration is itself a session change: an older successful heartbeat must
// not restore the session after a protected endpoint rejected it.
export const clearAuthSessionIfCurrent = (epoch: number, signal?: AbortSignal): boolean => {
  if (signal?.aborted || epoch !== sessionEpoch || mutationEpoch !== null) return false;
  sessionEpoch += 1;
  bootstrapPromise = null;
  applyAnonymousSession();
  return true;
};

export const bootstrapAuth = async (): Promise<void> => {
  // A heartbeat must not race a login/logout mutation in progress.
  if (mutationEpoch !== null) return;
  if (bootstrapPromise) return bootstrapPromise;
  const epoch = sessionEpoch;
  const pending = (async () => {
    authState.error = null;
    try {
      const payload = await apiFetch("/api/v2/auth/me", async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw await readError(response, "权限状态读取失败。");
        return (await response.json()) as AuthResponse;
      });
      if (epoch !== sessionEpoch) return;
      if (payload) applyAuthenticatedSession(payload);
      else applyAnonymousSession();
    } catch (error) {
      if (epoch !== sessionEpoch) return;
      const normalized = normalizeError(error, "权限状态读取失败。");
      applyAnonymousSession();
      authState.error = normalized.message;
      throw normalized;
    }
  })();
  bootstrapPromise = pending;
  try {
    await pending;
  } finally {
    if (bootstrapPromise === pending) bootstrapPromise = null;
  }
};

export const login = async (phone: string, password: string): Promise<AuthUser> => {
  const epoch = beginSessionMutation();
  authState.error = null;
  try {
    const payload = await apiFetch("/api/v2/auth/login", async (response) => {
      if (!response.ok) throw await readError(response, "登录失败，请检查账号后重试。");
      return (await response.json()) as AuthResponse;
    }, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    if (epoch === sessionEpoch) applyAuthenticatedSession(payload);
    return payload.user;
  } catch (error) {
    const normalized = normalizeError(error, "登录失败，请稍后再试。");
    if (epoch === sessionEpoch) {
      authState.ready = true;
      authState.error = normalized.message;
    }
    throw normalized;
  } finally {
    if (mutationEpoch === epoch) mutationEpoch = null;
  }
};

export const logout = async (): Promise<void> => {
  const epoch = beginSessionMutation();
  const needsLookup = !authState.ready || (authState.authenticated && !authState.csrfToken);
  const wasAuthenticated = authState.authenticated;
  let csrfToken = authState.csrfToken;
  authState.error = null;
  // Drop protected UI immediately, including when logout later times out.
  applyAnonymousSession();
  try {
    if (needsLookup) {
      const payload = await apiFetch("/api/v2/auth/me", async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw await readError(response, "权限状态读取失败。");
        return (await response.json()) as AuthResponse;
      });
      if (epoch !== sessionEpoch || !payload) return;
      csrfToken = payload.csrfToken;
    } else if (!wasAuthenticated) return;

    await apiFetch("/api/v2/auth/logout", async (response) => {
      if (!response.ok && response.status !== 401) {
        throw await readError(response, "退出失败，请稍后再试。");
      }
    }, {
      method: "POST",
      headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
    });
  } catch (error) {
    const normalized = normalizeError(error, "退出失败，请稍后再试。");
    if (epoch === sessionEpoch) authState.error = normalized.message;
    throw normalized;
  } finally {
    if (mutationEpoch === epoch) mutationEpoch = null;
  }
};
