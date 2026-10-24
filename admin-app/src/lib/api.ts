import type { ApiEnvelope, PageResult } from "@/types";

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v2";
export const API_BASE_URL = configuredBase.replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let csrfToken = "";
let onUnauthorized: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

const cookieValue = (name: string) => {
  const prefix = `${encodeURIComponent(name)}=`;
  const match = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
};

const readableCsrfCookie = () =>
  cookieValue("XSRF-TOKEN") || cookieValue("csrf_token") || cookieValue("hz_csrf");

export const setCsrfToken = (value?: string | null) => {
  csrfToken = value?.trim() || "";
};

const captureCsrf = (response: Response, payload?: unknown) => {
  const header = response.headers.get("X-CSRF-Token");
  if (header) setCsrfToken(header);
  if (payload && typeof payload === "object") {
    const envelope = payload as ApiEnvelope<unknown>;
    const data = envelope.data;
    const tokenFromData =
      data && typeof data === "object" && "csrfToken" in data
        ? String((data as { csrfToken?: unknown }).csrfToken || "")
        : "";
    setCsrfToken(envelope.csrfToken || tokenFromData || csrfToken);
  }
};

const parsePayload = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 204) return null;
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  return text ? { message: text } : null;
};

const errorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiEnvelope<unknown>;
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && body.error.message) {
    return body.error.message;
  }
  return body.message || fallback;
};

const errorCode = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as ApiEnvelope<unknown>).error;
  return error && typeof error === "object" ? error.code : undefined;
};

const isMutating = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);

export const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (isMutating(method)) {
    const token = csrfToken || readableCsrfCookie();
    if (token) headers.set("X-CSRF-Token", token);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    // Invalidate a rejected session even if its response body stalls or is malformed.
    if (response.status === 401) onUnauthorized?.();
    const payload = await parsePayload(response);
    if (response.status !== 401) captureCsrf(response, payload);
    if (!response.ok) {
      throw new ApiError(response.status, errorMessage(payload, `请求失败（${response.status}）`), errorCode(payload));
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(0, "请求超时，请检查网络连接。", "TIMEOUT");
    }
    if (error instanceof SyntaxError) throw new ApiError(0, "数据响应格式异常，请刷新后重试。", "INVALID_RESPONSE");
    throw new ApiError(0, "无法连接数据服务，请稍后重试。", "NETWORK_ERROR");
  } finally {
    window.clearTimeout(timeout);
  }
};

export const unwrapData = <T>(payload: ApiEnvelope<T> | T): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

export const normalizePage = <T extends Record<string, unknown>>(
  payload: ApiEnvelope<T[]> | { items?: T[]; total?: number; page?: number; pageSize?: number } | T[],
  fallbackPage: number,
  fallbackPageSize: number,
): PageResult<T> => {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      meta: { page: fallbackPage, pageSize: fallbackPageSize, total: payload.length },
    };
  }
  if ("data" in payload && Array.isArray(payload.data)) {
    return {
      items: payload.data,
      meta: {
        page: Number(payload.meta?.page || fallbackPage),
        pageSize: Number(payload.meta?.pageSize || fallbackPageSize),
        total: Number(payload.meta?.total ?? payload.data.length),
      },
    };
  }
  const legacy = payload as { items?: T[]; total?: number; page?: number; pageSize?: number };
  const items = Array.isArray(legacy.items) ? legacy.items : [];
  return {
    items,
    meta: {
      page: Number(legacy.page || fallbackPage),
      pageSize: Number(legacy.pageSize || fallbackPageSize),
      total: Number(legacy.total ?? items.length),
    },
  };
};

export const queryString = (params: Record<string, unknown>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== undefined && value !== null) query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
};
