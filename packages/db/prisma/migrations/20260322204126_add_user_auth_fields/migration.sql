-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DRIVER', 'STATION_MANAGER', 'FLEET_MANAGER', 'ADMIN', 'DATA_BUYER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "supertokens_id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'DRIVER',
    "fleet_id" TEXT,
    "trust_score" INTEGER NOT NULL DEFAULT 0,
    "shadow_banned" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_supertokens_id_key" ON "User"("supertokens_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
