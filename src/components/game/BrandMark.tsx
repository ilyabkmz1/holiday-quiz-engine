import type { PublicCampaign } from "@/types/api";

/** Логотип бренда пакета: картинка из `brand.logo` или плашка с отметкой и словом. */
export function BrandMark({ brand, strong = false }: { brand: PublicCampaign["brand"]; strong?: boolean }) {
  if (brand.logo) {
    // eslint-disable-next-line @next/next/no-img-element -- логотип арендатора: локальный файл из public/, оптимизатор отключён
    return <img className="brand-logo" src={brand.logo} alt={brand.name} height={36} />;
  }
  return (
    <>
      <span className="brand-mark">{brand.mark}</span>
      {strong ? <b>{brand.wordmark}</b> : <span>{brand.wordmark}</span>}
    </>
  );
}
