import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnouncementTable1776900000000 implements MigrationInterface {
  name = 'AddAnnouncementTable1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "announcement" (
        "id" SERIAL NOT NULL,
        "channelId" character varying NOT NULL,
        "messageTs" character varying NOT NULL,
        "title" character varying NOT NULL,
        "content" text NOT NULL,
        "authorId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcement"
        ADD CONSTRAINT "FK_announcement_author"
        FOREIGN KEY ("authorId") REFERENCES "user"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcement" DROP CONSTRAINT "FK_announcement_author"`,
    );
    await queryRunner.query(`DROP TABLE "announcement"`);
  }
}
