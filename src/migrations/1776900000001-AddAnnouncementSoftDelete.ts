import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnouncementSoftDelete1776900000001
  implements MigrationInterface
{
  name = 'AddAnnouncementSoftDelete1776900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcement" ADD "deletedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcement" DROP COLUMN "deletedAt"`,
    );
  }
}
