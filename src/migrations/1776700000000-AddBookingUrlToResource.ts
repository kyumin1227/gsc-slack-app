import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookingUrlToResource1776700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resource" ADD COLUMN IF NOT EXISTS "bookingUrl" varchar NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resource" DROP COLUMN IF EXISTS "bookingUrl"`,
    );
  }
}
