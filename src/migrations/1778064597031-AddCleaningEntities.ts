import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleaningEntities1778064597031 implements MigrationInterface {
  name = 'AddCleaningEntities1778064597031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."cleaning_schedules_status_enum" AS ENUM('예정', '완료', '취소')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_schedules" ("id" SERIAL NOT NULL, "resourceId" integer NOT NULL, "cleaningDate" date NOT NULL, "needPeoples" integer NOT NULL, "status" "public"."cleaning_schedules_status_enum" NOT NULL DEFAULT '예정', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_cleaning_schedules_resource_date" UNIQUE ("resourceId", "cleaningDate"), CONSTRAINT "PK_522baef1b63673ee622738f84ec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cleaning_assignments_status_enum" AS ENUM('배정', '완료', '취소', '불이행')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_assignments" ("id" SERIAL NOT NULL, "scheduleId" integer NOT NULL, "studentId" integer NOT NULL, "cleaningDate" date NOT NULL, "status" "public"."cleaning_assignments_status_enum" NOT NULL DEFAULT '배정', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_cleaning_assignments_student_date" UNIQUE ("studentId", "cleaningDate"), CONSTRAINT "PK_ff224d7c4384622ad7c71647987" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cleaning_trades_status_enum" AS ENUM('대기', '수락', '거절', '취소')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_trades" ("id" SERIAL NOT NULL, "requesterAssignmentId" integer NOT NULL, "targetAssignmentId" integer NOT NULL, "status" "public"."cleaning_trades_status_enum" NOT NULL DEFAULT '대기', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_2145923e043b8d7b9b639a01d49" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "calendarId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_schedules" ADD CONSTRAINT "FK_cleaning_schedules_resource" FOREIGN KEY ("resourceId") REFERENCES "resource"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "FK_cleaning_assignments_schedule" FOREIGN KEY ("scheduleId") REFERENCES "cleaning_schedules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "FK_cleaning_assignments_student" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_trades" ADD CONSTRAINT "FK_cleaning_trades_requester" FOREIGN KEY ("requesterAssignmentId") REFERENCES "cleaning_assignments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_trades" ADD CONSTRAINT "FK_cleaning_trades_target" FOREIGN KEY ("targetAssignmentId") REFERENCES "cleaning_assignments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cleaning_trades" DROP CONSTRAINT "FK_cleaning_trades_target"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_trades" DROP CONSTRAINT "FK_cleaning_trades_requester"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "FK_cleaning_assignments_student"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "FK_cleaning_assignments_schedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_schedules" DROP CONSTRAINT "FK_cleaning_schedules_resource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "name" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "calendarId" DROP NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE "cleaning_trades"`);
    await queryRunner.query(
      `DROP TYPE "public"."cleaning_trades_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "cleaning_assignments"`);
    await queryRunner.query(
      `DROP TYPE "public"."cleaning_assignments_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "cleaning_schedules"`);
    await queryRunner.query(
      `DROP TYPE "public"."cleaning_schedules_status_enum"`,
    );
  }
}
