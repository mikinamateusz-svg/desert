-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('community', 'seeded');

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN "source" "PriceSource" NOT NULL DEFAULT 'community';
