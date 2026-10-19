export {};

const baseUrl = process.env.LOAD_TEST_URL ?? "http://127.0.0.1:3000";
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? "25");

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 60) {
  // Создание сессии ограничено 60 запросами в минуту на адрес: больше параллельных игр упрётся в лимит.
  throw new Error("LOAD_TEST_CONCURRENCY must be an integer from 1 to 60");
}

async function request(path: string, init: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin: baseUrl,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...init.headers
    }
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status}`);
  return response;
}

type LoadTask =
  | { id: string; type: "pick" | "phish"; options?: Array<{ id: string }>; letters?: Array<{ id: string }> }
  | { id: string; type: "build"; slots: number; options: Array<{ id: string }> }
  | { id: string; type: "access" }
  | { id: string; type: "order"; items: Array<{ id: string }> };

/** Допустимый по форме ответ без знания верного: нагрузке важны запросы, а не очки. */
function anyPayload(task: LoadTask) {
  switch (task.type) {
    case "pick":
    case "phish":
      return { optionId: (task.options ?? task.letters)![0].id };
    case "build":
      return { optionIds: task.options.slice(0, task.slots).map((option) => option.id) };
    case "access":
      return { enabledIds: [] };
    case "order":
      return { orderedIds: task.items.map((item) => item.id) };
  }
}

async function completeSession() {
  const started = await request("/api/sessions", { method: "POST" });
  const cookie = started.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Session cookie was not returned");
  const payload = await started.json() as {
    sessionId: string;
    campaign: { rooms: Array<{ id: string; taskIds: string[] }>; rush: { services: Array<{ id: string }> } };
  };
  const base = `/api/sessions/${payload.sessionId}`;
  for (const room of payload.campaign.rooms) {
    await request(`${base}/rooms/${room.id}/enter`, { method: "POST" }, cookie);
    for (let index = 0; index < room.taskIds.length; index += 1) {
      const { task } = await (await request(`${base}/rooms/${room.id}/task`, {}, cookie)).json() as { task: LoadTask };
      await request(`${base}/answers`, {
        method: "POST",
        body: JSON.stringify({ taskId: task.id, payload: anyPayload(task) })
      }, cookie);
    }
  }
  const { rush } = await (await request(`${base}/rush/start`, { method: "POST" }, cookie)).json() as {
    rush: { current: { itemId: string } | null };
  };
  if (rush.current) {
    await request(`${base}/rush/answer`, {
      method: "POST",
      body: JSON.stringify({ itemId: rush.current.itemId, serviceId: payload.campaign.rush.services[0].id })
    }, cookie);
  }
  await request(`${base}/rush/finish`, { method: "POST" }, cookie);
  await request(`${base}/complete`, { method: "POST" }, cookie);
}

const startedAt = performance.now();
const results = await Promise.allSettled(Array.from({ length: concurrency }, () => completeSession()));
const failures = results.filter((result) => result.status === "rejected");
console.info(JSON.stringify({
  concurrency,
  completed: results.length - failures.length,
  failed: failures.length,
  durationMs: Math.round(performance.now() - startedAt)
}));
if (failures.length) throw failures[0].reason;
