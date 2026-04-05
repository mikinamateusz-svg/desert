-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_submission_id_idx" ON "AdminAuditLog"("submission_id");

-- CreateIndex
CREATE INDEX "AdminAuditLog_admin_user_id_created_at_idx" ON "AdminAuditLog"("admin_user_id", "created_at");
