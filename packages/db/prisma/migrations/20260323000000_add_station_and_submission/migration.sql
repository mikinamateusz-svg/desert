-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('pending', 'verified', 'rejected', 'shadow_rejected');

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "station_id" TEXT,
    "price_data" JSONB NOT NULL,
    "photo_r2_key" TEXT,
    "ocr_confidence_score" DOUBLE PRECISION,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Submission_user_id_created_at_idx" ON "Submission"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
