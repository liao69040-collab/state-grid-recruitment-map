import { computed, reactive } from "vue";
import { request, setCsrfToken, setUnauthorizedHandler, unwrapData } from "./api";
import type { AdminIdentity, ApiEnvelope, AuthPayload } from "@/types";

interface AuthState {
  ready: boolean;
  loading: boolean;
  authenticated: boolean;
  admin: AdminIdentity | null;
}

const state = reactive<AuthState>({
  ready: false,
  loading: false,
  authenticated: false,
  admin: null,
});

let bootstrapPromise: Promise<boolean> | null = null;

const clearSession = () => {
  state.authenticated = false;
  state.admin = null;
  setCsrfToken("");
};

setUnauthorizedHandler(clearSession);

const applyPayload = (payload: AuthPayload) => {
  state.authenticated = true;
  state.admin = payload.admin;
  setCsrfToken(payload.csrfToken);
};

const bootstrap = async () => {
  if (bootstrapPromise) return bootstrapPromise;
  state.loading = true;
  bootstrapPromise = (async () => {
    try {
      const response = await request<ApiEnvelope<AuthPayload>>("/admin/auth/me");
      applyPayload(unwrapData(response));
      return true;
    } catch {
      clearSession();
      return false;
    } finally {
      state.ready = true;
      state.loading = false;
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
};

const login = async (username: string, password: string) => {
  state.loading = true;
  try {
    const response = await request<ApiEnvelope<AuthPayload>>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const payload = unwrapData(response);
    applyPayload(payload);
    state.ready = true;
    return payload.admin;
  } finally {
    state.loading = false;
  }
};

const logout = async () => {
  try {
    await request<null>("/admin/auth/logout", { method: "POST" });
  } finally {
    clearSession();
  }
};

export const adminAuth = {
  state,
  isAuthenticated: computed(() => state.authenticated),
  bootstrap,
  login,
  logout,
  clearSession,
};
