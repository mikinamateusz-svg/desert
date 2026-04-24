-- CreateTable
CREATE TABLE "PriceReferencePoint" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fuel_type" TEXT NOT NULL,
    "value_type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PLN/l',
    "as_of" TIMESTAMP(3) NOT NULL,
    "sample_size" INTEGER,
    "metadata" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceReferencePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceReferencePoint_source_fuel_type_as_of_idx" ON "PriceReferencePoint"("source", "fuel_type", "as_of" DESC);

-- CreateIndex
CREATE INDEX "PriceReferencePoint_fuel_type_value_type_as_of_idx" ON "PriceReferencePoint"("fuel_type", "value_type", "as_of" DESC);

-- CreateTable
CREATE TABLE "PriceValidationRule" (
    "id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "applies_to" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceValidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceValidationRule_enabled_rule_type_idx" ON "PriceValidationRule"("enabled", "rule_type");

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- Seed initial VAT multiplier — standard Polish fuel VAT is 23%.
-- Flipped to "1.08" during Ministry of Finance reduced-rate periods.
INSERT INTO "SystemConfig" ("key", "value", "description", "updated_at")
VALUES ('vat_multiplier', '1.23', 'VAT multiplier applied to rack prices when estimating retail. Standard PL fuel VAT = 23% (multiplier 1.23). Reduced rate (8%) → 1.08.', CURRENT_TIMESTAMP);
