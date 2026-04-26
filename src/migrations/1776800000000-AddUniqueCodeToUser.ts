import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueCodeToUser1776800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "code" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_user_code" UNIQUE ("code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_user_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "code" DROP NOT NULL`,
    );
  }
}
