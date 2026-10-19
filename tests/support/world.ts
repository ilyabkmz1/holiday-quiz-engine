import { buildWorldModel } from "@/worlds/model";
import { loadWorld } from "@/worlds/registry";

/** Эталонный мир (снежный шар) и его модель для зон эталонного пакета demo-office (id зон совпадают с id точек мира). */
export const snowGlobe = loadWorld("snow-globe");
export const snowGlobeRooms = snowGlobe.spots.map((spot) => ({ id: spot.id }));
export const snowGlobeModel = buildWorldModel(snowGlobe, snowGlobeRooms);

// Форма констант, которые раньше экспортировал `world-data.ts`: тесты разметки мира snow-globe проверяют те же значения.
export const WORLD_W = snowGlobe.art.width;
export const WORLD_H = snowGlobe.art.height;
export const NODES = snowGlobe.nodes;
export const EDGES = snowGlobe.edges;
export const ROOM_SPOTS = snowGlobe.spots.map(({ id, pad, hero, box }) => ({ roomId: id, pad, hero, box }));
export const RUSH_SPOTS: Readonly<Record<string, readonly [number, number]>> = Object.fromEntries(snowGlobe.spots.map((spot) => [spot.id, spot.rush]));
export const START_NODE = snowGlobe.start;
export const TREE_NODE = snowGlobe.tree;
export const TREE_SLOTS = snowGlobe.treeSlots;
