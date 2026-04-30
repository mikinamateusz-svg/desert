-- Make submission_id nullable so override-price audit logs (which have no
-- associated submission) can be written without violating the NOT NULL constraint.
ALTER TABLE "AdminAuditLog" ALTER COLUMN "submission_id" DROP NOT NULL;
