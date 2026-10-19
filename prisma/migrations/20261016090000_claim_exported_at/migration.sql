-- Момент первой выгрузки заявки в CSV: нужен дашборду оператора для воронки по дням. Аддитивно, NULL у прежних строк.
ALTER TABLE "PrizeClaim" ADD COLUMN "exportedAt" TIMESTAMP(3);
