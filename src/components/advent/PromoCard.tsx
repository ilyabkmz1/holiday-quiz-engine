"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AdventIcon } from "@/components/advent/icons";
import { dateTimeLabel, fill, grantCondition, safeHref } from "@/components/advent/format";
import { qrModel } from "@/components/advent/qr";
import type { AdventCopy } from "@/config/advent-schema";
import type { AdventGrantView } from "@/types/advent";

type Props = {
  grant: AdventGrantView;
  copy: AdventCopy;
  timezone: string;
  /** Серверное «сейчас» (мс): срок считается по часам сервера, а не устройства (в демо время сдвигает `asOf`). */
  nowMs: number;
  /** Предложить сохранить прогресс, когда код ждёт входа по ссылке. */
  onNeedIdentity?: () => void;
  /** Подсвечивать появление (раскрытие награды); в списке уже полученных выключено. */
  fresh?: boolean;
};

/** QR для кассы: тёмные модули на светлом поле с полем тишины в 4 модуля, как требует стандарт. */
function Qr({ payload, label }: { payload: string; label: string }) {
  const model = useMemo(() => qrModel(payload), [payload]);
  const quiet = 4;
  const side = model.size + quiet * 2;
  return (
    <svg className="adv-qr" role="img" aria-label={label} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges">
      <rect width={side} height={side} className="adv-qr-bg" />
      <path d={model.path} transform={`translate(${quiet} ${quiet})`} className="adv-qr-fg" />
    </svg>
  );
}

/**
 * Награда: код (крупно, с копированием), срок, QR для кассы или ссылка для онлайн-погашения.
 * Код и QR приходят только владельцу; если кода ещё нет, объясняем почему (вход по ссылке или пустой пул).
 */
export function PromoCard({ grant, copy, timezone, nowMs, onNeedIdentity, fresh = false }: Props) {
  const codeRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const condition = grantCondition(grant, nowMs);
  const href = safeHref(grant.url);
  const cashier = grant.redeem === "cashier" || grant.redeem === "both";
  const online = grant.redeem === "online" || grant.redeem === "both";

  async function copyCode() {
    if (!grant.code) return;
    let text = copy.promoCopied;
    try {
      await navigator.clipboard.writeText(grant.code);
    } catch {
      // Буфер недоступен (http, запрет разрешения): выделяем код, чтобы его можно было скопировать вручную.
      const range = document.createRange();
      if (codeRef.current) range.selectNodeContents(codeRef.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      text = copy.promoCopyFailed;
    }
    setMessage(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }

  return (
    <article className={`adv-promo${fresh ? " adv-promo-fresh" : ""}`} data-condition={condition} aria-label={grant.label}>
      <header className="adv-promo-head">
        <span className="adv-promo-badge" aria-hidden="true"><AdventIcon name="gift" size={22} /></span>
        <div>
          <h3 className="adv-promo-label">{grant.label}</h3>
          {grant.description && <p className="adv-promo-desc">{grant.description}</p>}
        </div>
      </header>

      {grant.code ? (
        <div className="adv-promo-codebox">
          <span className="adv-promo-codecap">{copy.promoCode}</span>
          <code className="adv-promo-code" ref={codeRef} data-testid="promo-code">{grant.code}</code>
          <button type="button" className="adv-btn adv-btn-ghost" onClick={() => void copyCode()}>
            <AdventIcon name="copy" size={16} /> {copy.promoCopy}
          </button>
          <span className="sr-only" role="status" aria-live="polite">{message ?? ""}</span>
          {message && <span className="adv-promo-toast" aria-hidden="true">{message}</span>}
        </div>
      ) : grant.needsIdentity ? (
        <div className="adv-promo-wait">
          <p>{copy.promoNeedsIdentity}</p>
          {onNeedIdentity && (
            <button type="button" className="adv-btn adv-btn-ghost" onClick={onNeedIdentity}>
              <AdventIcon name="mail" size={16} /> {copy.saveTitle}
            </button>
          )}
        </div>
      ) : grant.codePending ? (
        <div className="adv-promo-wait"><p>{copy.promoCodePending}</p></div>
      ) : null}

      {cashier && grant.qr && condition === "active" && (
        <figure className="adv-promo-qr">
          <Qr payload={grant.qr.payload} label={copy.promoQrLabel} />
          <figcaption>{copy.promoCashier}</figcaption>
        </figure>
      )}

      {online && href && condition === "active" && (
        <a className="adv-btn adv-btn-primary" href={href} target="_blank" rel="noopener noreferrer">
          <AdventIcon name="link" size={16} /> {copy.promoOnline}
        </a>
      )}

      <footer className="adv-promo-foot">
        {condition === "redeemed" && grant.redeemedAt ? (
          <span className="adv-tag adv-tag-done">{fill(copy.promoRedeemed, { date: dateTimeLabel(grant.redeemedAt, timezone) })}</span>
        ) : condition === "expired" ? (
          <span className="adv-tag adv-tag-off">{copy.promoExpired}</span>
        ) : grant.expiresAt ? (
          <span className="adv-tag">{fill(copy.promoValidUntil, { date: dateTimeLabel(grant.expiresAt, timezone) })}</span>
        ) : null}
      </footer>
    </article>
  );
}
