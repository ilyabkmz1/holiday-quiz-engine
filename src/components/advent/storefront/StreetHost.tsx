"use client";

import type { StreetWalker } from "@/components/advent/storefront/useStreetWalker";
import { HeroSprite } from "@/components/quest/sprites";
import type { PublicHero } from "@/types/api";

/**
 * Хозяин на снежной улице перед стеной: декоративный (`aria-hidden`), кнопки окон и плашки остаются единственным способом действовать.
 * Положение двигает `useStreetWalker` через `transform` дорожки; спрайт и позы ходьбы — из квеста (`HeroSprite`).
 */
export function StreetHost({ host, walker }: { host: PublicHero; walker: StreetWalker }) {
  const { trackRef, look } = walker;
  const { pose, facing } = look;
  return (
    <span className="adv-street" aria-hidden="true">
      <span className="adv-street-track" ref={trackRef}>
        <span className="adv-street-host" data-pose={pose}>
          <HeroSprite hero={host} mood={pose === "run" ? "neutral" : "happy"} pose={pose} facing={facing} marker={null} />
        </span>
      </span>
    </span>
  );
}
