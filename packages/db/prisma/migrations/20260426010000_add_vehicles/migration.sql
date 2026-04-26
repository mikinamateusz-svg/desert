-- Story 5.1: per-driver vehicle records.
-- fuel_type stored as TEXT (not enum) — catalog may grow new fuel types
-- (CNG, hydrogen, etc.) faster than schema migrations; DTO validator restricts
-- the accepted set at the API boundary.
-- is_locked is set to true by Story 5.2 on the first FillUp linked to the
-- vehicle; while locked, make/model/year cannot change and DELETE is blocked.

CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "engine_variant" TEXT,
    "displacement_cc" INTEGER,
    "power_kw" INTEGER,
    "fuel_type" TEXT NOT NULL,
    "nickname" TEXT,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "user_entered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Vehicle_user_id_idx" ON "Vehicle"("user_id");

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
