-- CreateTable
CREATE TABLE "DailyApiCost" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyApiCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyApiCost_date_key" ON "DailyApiCost"("date");
