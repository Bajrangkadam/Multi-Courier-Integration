import { config } from "../config";
import { AppError } from "../errors/AppError";

export async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = config.courierTimeoutMs): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { rawText: text }; }
    if (!response.ok) {
      const status = response.status;
      // Do not expose raw upstream body to consumers.
      throw new AppError(
        status === 401 || status === 403 ? status : (status >= 500 ? 502 : 422),
        status === 401 || status === 403 ? "COURIER_AUTH_REJECTED" : (status >= 500 ? "COURIER_UPSTREAM_FAILURE" : "COURIER_REQUEST_REJECTED"),
        status >= 500 ? "Courier provider is temporarily unavailable" : "Courier provider rejected the request",
        undefined,
        status >= 500,
        { courierResponse: body }
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as Error).name === "AbortError") throw new AppError(504, "COURIER_TIMEOUT", "Courier provider timed out", undefined, true);
    throw new AppError(502, "COURIER_NETWORK_ERROR", "Could not connect to courier provider", undefined, true);
  } finally { clearTimeout(timeout); }
}
