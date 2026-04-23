-- CreateTable
CREATE TABLE "ResearchPhoto" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "station_id" TEXT,
    "ocr_prices" JSONB NOT NULL,
    "final_prices" JSONB,
    "actual_prices" JSONB,
    "label_notes" TEXT,
    "final_status" "SubmissionStatus" NOT NULL,
    "flag_reason" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "retained_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPhoto_submission_id_key" ON "ResearchPhoto"("submission_id");

-- CreateIndex
CREATE INDEX "ResearchPhoto_retained_until_idx" ON "ResearchPhoto"("retained_until");

-- AddForeignKey
ALTER TABLE "ResearchPhoto" ADD CONSTRAINT "ResearchPhoto_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
