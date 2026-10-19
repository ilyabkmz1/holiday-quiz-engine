import { ApiError } from "@/components/game/api";
import type {
  AdventState,
  CreateParticipantResponse,
  IdentityRequestResponse,
  OpenDayResponse,
  SubmitBlockResponse
} from "@/types/advent";

export { ApiError };

/** Заголовок сдвига времени для демо и скриншотов (см. `resolveNow`); в боевом режиме сервер его игнорирует. */
const AS_OF_HEADER = "x-advent-as-of";

/** `?asOf=<ISO>` из адресной строки страницы: показать клиенту день 7 сегодня. */
export function readAsOf(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("asOf");
  } catch {
    return null;
  }
}

export type Timed<T> = T & { serverDate: number | null };

async function request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<Timed<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const asOf = readAsOf();
  if (asOf) headers[AS_OF_HEADER] = asOf;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  } catch {
    throw new ApiError(0, "Нет соединения. Проверьте интернет и повторите.");
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Не удалось выполнить запрос.";
    throw new ApiError(response.status, message);
  }
  const date = Date.parse(response.headers.get("date") ?? "");
  return { ...(payload as T), serverDate: Number.isNaN(date) ? null : date };
}

const dayPath = (n: number) => `/api/advent/days/${n}`;

export const adventApi = {
  getState: () => request<AdventState>("/api/advent/state", "GET"),
  createParticipant: () => request<CreateParticipantResponse>("/api/advent/participants", "POST"),
  openDay: (n: number) => request<OpenDayResponse>(`${dayPath(n)}/open`, "POST"),
  /** Пустое тело — подтверждение истории; для задания и удачи — `payload`. Результат приходит только после записи. */
  submitBlock: (n: number, index: number, payload?: Record<string, unknown>) =>
    request<SubmitBlockResponse>(`${dayPath(n)}/blocks/${index}`, "POST", payload ? { payload } : {}),
  requestLink: (input: { email: string; consent: boolean; marketingConsent: boolean; reminderOptIn: boolean }) =>
    request<IdentityRequestResponse>("/api/advent/identity/request", "POST", input)
};

export type AdventApi = typeof adventApi;
