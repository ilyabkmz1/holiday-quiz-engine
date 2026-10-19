"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Отмечает подтверждённые заявки выгруженными (POST, same-origin), затем скачивает CSV. */
export function ExportButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportClaims() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/claims/export", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const link = document.createElement("a");
      link.href = "/api/admin/claims.csv";
      link.download = "";
      link.click();
      router.refresh();
    } catch {
      setError("Не удалось отметить выгрузку. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="admin-button" onClick={exportClaims} disabled={busy}>Выгрузить CSV</button>
      {error && <span role="alert" className="admin-note"> {error}</span>}
    </span>
  );
}
