-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('CORE_SERVICE');

-- CreateTable
CREATE TABLE "UserConsent" (
    "id"           TEXT NOT NULL,
    "user_id"      TEXT NOT NULL,
    "type"         "ConsentType" NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserConsent_user_id_type_key" ON "UserConsent"("user_id", "type");

-- AddForeignKey
ALTER TABLE "UserConsent"
    ADD CONSTRAINT "UserConsent_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
