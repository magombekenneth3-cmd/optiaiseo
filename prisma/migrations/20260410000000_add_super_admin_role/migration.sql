-- Add SUPER_ADMIN value to the Role enum (safe — IF NOT EXISTS prevents errors on re-run)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
