// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorld, WorldProvider } from "@/components/play/world-context";
import { QuestWorld } from "@/components/quest/QuestWorld";
import { packSchema } from "@/config/pack";
import { publicCampaign } from "@/server/presentation";
import { overrideWorlds, loadWorld } from "@/worlds/registry";
import coffeePack from "@tenants/demo-coffee/pack.json";
import ring from "../fixtures/worlds/ring.json";

beforeEach(() => {
  overrideWorlds({ "ring-fixture": ring });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  overrideWorlds(null);
});

describe("квест на втором мире (ring-fixture, зоны кофейни со своим spotId)", () => {
  function mount() {
    const pack = packSchema.parse(structuredClone(coffeePack));
    const world = loadWorld("ring-fixture");
    pack.campaign.rooms.forEach((room, index) => {
      room.spotId = world.spots[index].id;
      room.map = world.spots[index].card;
    });
    const campaign = publicCampaign(pack.campaign, "ring-fixture");
    const session = {
      id: "s1", status: "playing" as const, score: 0, combo: 0, roomsCompleted: 0, rushUnlocked: false, rush: null, answers: [], completedAt: null, final: null,
      rooms: campaign.rooms.map((room) => ({ roomId: room.id, entered: false, enteredAt: null, spentMs: 0, taskShownAt: null, answered: 0, completed: false, currentTaskId: null, next: null, fuses: 3, summary: null }))
    };
    const view = render(
      <WorldProvider world={world} rooms={campaign.rooms}>
        <QuestWorld
          campaign={campaign}
          session={session}
          heroes={{}}
          stage="explore"
          lit={new Set()}
          focusRoom={null}
          sheet={{ bottom: 0, right: 0 }}
          goalRoom={campaign.rooms[0].id}
          bubbles={[]}
          celebrate={null}
          onCelebrated={() => undefined}
          fault={null}
          prologueStep={3}
          prologueHero={null}
          services={null}
          onService={() => undefined}
          onHelp={() => undefined}
          onFlakes={() => undefined}
          finale={false}
          treeFlakes={0}
        />
      </WorldProvider>
    );
    return { view, world, campaign };
  }

  it("рисует иллюстрацию и рамки комнат выбранного мира по spotId зон, а не по их id", () => {
    const { view, world, campaign } = mount();
    expect(view.container.querySelector("img.qw-img")?.getAttribute("src")).toContain(encodeURIComponent(world.art.src));
    for (const [index, room] of campaign.rooms.entries()) {
      const frame = view.container.querySelector<HTMLElement>(`.qw-room[data-room="${room.id}"]`);
      expect(frame, room.id).not.toBeNull();
      expect(frame!.style.left).toBe(`${world.spots[index].box.x}%`);
      expect(frame!.style.top).toBe(`${world.spots[index].box.y}%`);
    }
    expect(view.container.querySelectorAll(".qw-room")).toHaveLength(world.spots.length);
    expect(screen.getByRole("button", { name: "Список комнат" })).toBeInTheDocument();
  });
});

describe("карточный режим: зона без точки мира", () => {
  it("мир доступен компонентам, модель квеста не строится и страницу не роняет", () => {
    const pack = packSchema.parse(structuredClone(coffeePack));
    delete pack.campaign.rooms[0].spotId;
    const campaign = publicCampaign(pack.campaign, pack.worldId);
    const world = loadWorld(pack.worldId);
    function Probe() {
      return <span>{useWorld().art.src}</span>;
    }
    expect(() => render(<WorldProvider world={world} rooms={campaign.rooms}><Probe /></WorldProvider>)).not.toThrow();
    expect(screen.getByText(world.art.src)).toBeInTheDocument();
  });
});
