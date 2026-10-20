"use client";

import { AdventIcon } from "@/components/advent/icons";
import { Burst } from "@/components/advent/Burst";
import type { AdventCopy } from "@/config/advent-schema";
import type { AdventGrantView } from "@/types/advent";

/** «С возвращением!»: бонус за возвращение после пропуска. Закрывается; показ запоминает родитель. */
export function ComebackBanner({ copy, grant, reduced, onClose }: { copy: AdventCopy; grant: AdventGrantView; reduced: boolean; onClose: () => void }) {
  return (
    <aside className="adv-comeback" role="status" aria-label={copy.comebackTitle}>
      {!reduced && <Burst count={18} spread={90} />}
      <span className="adv-comeback-badge" aria-hidden="true"><AdventIcon name="gift" size={22} /></span>
      <div>
        <b>{copy.comebackTitle}</b>
        <p>{copy.comebackText} <span className="adv-comeback-label">{grant.label}</span></p>
      </div>
      <button type="button" className="adv-icon-btn" onClick={onClose} aria-label={copy.comebackClose}>
        <AdventIcon name="close" size={18} />
      </button>
    </aside>
  );
}
