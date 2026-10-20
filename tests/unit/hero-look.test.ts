import { describe, expect, it } from "vitest";

import { lookOf } from "@/components/quest/sprites";
import { adventPackSchema } from "@/config/pack";
import { heroLookSchema } from "@/config/schema";
import { publicAdvent } from "@/server/presentation";
import { packs } from "@tenants/index";

const coffee = adventPackSchema.parse((packs as Array<{ tenant: string }>).find((pack) => pack.tenant === "demo-coffee-advent"));

describe("внешность героя (hero.look)", () => {
  it("без look внешность устойчива по id, с look — из пакета", () => {
    expect(lookOf({ id: "mila" })).toEqual(lookOf({ id: "mila" }));
    expect(lookOf({ id: "mila", look: { hair: "long" } }).style).toBe("long");
    expect(lookOf({ id: "mila", look: { hair: "bun", hairColor: "blond", skin: "deep" } })).toMatchObject({ style: "bun", color: "#d9a94e", skin: 3 });
  });

  it("схема пускает только закрытые значения", () => {
    expect(heroLookSchema.safeParse({ hair: "long", hairColor: "auburn", skin: "tan" }).success).toBe(true);
    expect(heroLookSchema.safeParse({ hair: "mohawk" }).success).toBe(false);
    expect(heroLookSchema.safeParse({ hair: "long", hairColor: "#ff0000" }).success).toBe(false);
  });

  it("look уходит на клиент вместе с героем; хозяйка кофейни Мила — не в кепке", () => {
    const view = publicAdvent(coffee.advent, coffee.tenant);
    const mila = view.heroes.find((hero) => hero.id === view.facade!.hostHeroId)!;
    expect(mila.name).toBe("Мила");
    expect(mila.look).toEqual({ hair: "long", hairColor: "auburn" });
    expect(lookOf(mila).style).not.toBe("cap");
  });
});
