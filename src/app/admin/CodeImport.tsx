"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Report = { rows: number; added: number; duplicatesInFile: number; alreadyInPool: number; invalid: number };

/** Загрузка CSV с кодами в пул награды (POST, same-origin). Показывает отчёт: добавлено, дубли, ошибочные строки. */
export function CodeImport({ rewardId }: { rewardId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const response = await fetch(`/api/admin/advent/codes?rewardId=${encodeURIComponent(rewardId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "text/csv" },
        body: await file.text()
      });
      const body = (await response.json()) as Report & { error?: string };
      if (!response.ok) throw new Error(body.error ?? String(response.status));
      setReport(body);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : "Не удалось загрузить файл.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <label className="admin-button">
        {busy ? "Загрузка…" : "Загрузить CSV"}
        <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      {report && (
        <span role="status" className="admin-note"> Добавлено {report.added}; дублей в файле {report.duplicatesInFile}, уже были {report.alreadyInPool}, ошибочных строк {report.invalid}.</span>
      )}
      {error && <span role="alert" className="admin-note"> {error}</span>}
    </span>
  );
}
