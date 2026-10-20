import qrcode from "qrcode-generator";

export type QrModel = { size: number; path: string };

/**
 * QR-код как один SVG-путь (квадраты 1×1 в сетке `size`): без внешних сервисов и без `canvas`.
 * Уровень коррекции M: код выдачи (`ADV1.<id>.<подпись>`, ~70 знаков) помещается в версию 5–6 и читается с экрана телефона.
 */
export function qrModel(payload: string): QrModel {
  const qr = qrcode(0, "M");
  qr.addData(payload, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!qr.isDark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && qr.isDark(row, col)) col += 1;
      path += `M${start} ${row}h${col - start}v1h-${col - start}z`;
    }
  }
  return { size, path };
}
