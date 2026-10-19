import type {
  AnswerRequest,
  AnswerResponse,
  CompleteResponse,
  CreateSessionResponse,
  EnterRoomResponse,
  GetSessionResponse,
  RoomTaskResponse,
  RushAnswerResponse,
  RushFinishResponse,
  RushStartResponse
} from "@/types/api";

export const SESSION_STORAGE_KEY = "hqe-holiday-quiz-session";

/** Ошибка API: `status` равен 0, если ответа не было (сеть). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Timed<T> = T & { serverDate: number | null };

async function request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<Timed<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
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

const base = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export const gameApi = {
  createSession: () => request<CreateSessionResponse>("/api/sessions", "POST"),
  getSession: (id: string) => request<GetSessionResponse>(base(id), "GET"),
  enterRoom: (id: string, roomId: string) => request<EnterRoomResponse>(`${base(id)}/rooms/${roomId}/enter`, "POST"),
  /** `answeredTaskId`: уже отвеченное задание комнаты (для показа его разбора после перезагрузки). */
  roomTask: (id: string, roomId: string, answeredTaskId?: string) =>
    request<RoomTaskResponse>(
      `${base(id)}/rooms/${roomId}/task${answeredTaskId ? `?taskId=${encodeURIComponent(answeredTaskId)}` : ""}`,
      "GET"
    ),
  answer: (id: string, body: AnswerRequest) => request<AnswerResponse>(`${base(id)}/answers`, "POST", body),
  startRush: (id: string) => request<RushStartResponse>(`${base(id)}/rush/start`, "POST"),
  answerRush: (id: string, itemId: string, serviceId: string) =>
    request<RushAnswerResponse>(`${base(id)}/rush/answer`, "POST", { itemId, serviceId }),
  finishRush: (id: string) => request<RushFinishResponse>(`${base(id)}/rush/finish`, "POST"),
  complete: (id: string) => request<CompleteResponse>(`${base(id)}/complete`, "POST")
};
