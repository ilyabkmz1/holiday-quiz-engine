import { StorefrontBuild, StorefrontOrder } from "@/components/advent/storefront/skins/LayerSkin";
import { StorefrontPick } from "@/components/advent/storefront/skins/PickSkin";
import type { TaskSkin } from "@/components/play/TaskMechanic";

export { StorefrontSkinContext } from "@/components/advent/storefront/skins/context";

/** Обложка заданий «Витрины» для `TaskMechanic`: «собери» для `build` и `order`, предметы на прилавке для `pick`. */
export const STOREFRONT_SKIN: TaskSkin = { pick: StorefrontPick, build: StorefrontBuild, order: StorefrontOrder };
