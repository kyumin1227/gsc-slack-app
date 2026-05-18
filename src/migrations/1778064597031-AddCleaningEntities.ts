import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleaningEntities1778064597031 implements MigrationInterface {
  name = 'AddCleaningEntities1778064597031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cleaning_rules" ("id" SERIAL NOT NULL, "studentClassId" integer NOT NULL, "cycle" integer NOT NULL, "needPeoples" integer NOT NULL, "daysOfWeek" integer[] NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_cleaning_rules" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_rule_resources" ("id" SERIAL NOT NULL, "ruleId" integer NOT NULL, "resourceId" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_cleaning_rule_resources_ruleId" UNIQUE ("ruleId"), CONSTRAINT "PK_cleaning_rule_resources" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_rule_users" ("id" SERIAL NOT NULL, "ruleId" integer NOT NULL, "userId" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_cleaning_rule_users_ruleId_userId" UNIQUE ("ruleId", "userId"), CONSTRAINT "PK_cleaning_rule_users" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cleaning_schedules_status_enum" AS ENUM('예정', '완료', '취소')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_schedules" ("id" SERIAL NOT NULL, "ruleId" integer NOT NULL, "cleaningDate" date NOT NULL, "needPeoples" integer NOT NULL, "status" "public"."cleaning_schedules_status_enum" NOT NULL DEFAULT '예정', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_cleaning_schedules_ruleId_cleaningDate" UNIQUE ("ruleId", "cleaningDate"), CONSTRAINT "PK_cleaning_schedules" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cleaning_assignments_status_enum" AS ENUM('배정', '완료', '취소', '미실시')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_assignments" ("id" SERIAL NOT NULL, "scheduleId" integer NOT NULL, "userId" integer NOT NULL, "status" "public"."cleaning_assignments_status_enum" NOT NULL DEFAULT '배정', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_cleaning_assignments_scheduleId_userId" UNIQUE ("scheduleId", "userId"), CONSTRAINT "PK_cleaning_assignments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cleaning_trades_status_enum" AS ENUM('대기', '수락', '거절', '취소')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cleaning_trades" ("id" SERIAL NOT NULL, "requesterAssignmentId" integer NOT NULL, "targetAssignmentId" integer NOT NULL, "status" "public"."cleaning_trades_status_enum" NOT NULL DEFAULT '대기', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_cleaning_trades" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rules" ADD CONSTRAINT "FK_cleaning_rules_studentClass" FOREIGN KEY ("studentClassId") REFERENCES "student_class"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_resources" ADD CONSTRAINT "FK_cleaning_rule_resources_rule" FOREIGN KEY ("ruleId") REFERENCES "cleaning_rules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_resources" ADD CONSTRAINT "FK_cleaning_rule_resources_resource" FOREIGN KEY ("resourceId") REFERENCES "resource"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_users" ADD CONSTRAINT "FK_cleaning_rule_users_rule" FOREIGN KEY ("ruleId") REFERENCES "cleaning_rules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_users" ADD CONSTRAINT "FK_cleaning_rule_users_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_schedules" ADD CONSTRAINT "FK_cleaning_schedules_rule" FOREIGN KEY ("ruleId") REFERENCES "cleaning_rules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "FK_cleaning_assignments_schedule" FOREIGN KEY ("scheduleId") REFERENCES "cleaning_schedules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "FK_cleaning_assignments_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
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
      `ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "FK_cleaning_assignments_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "FK_cleaning_assignments_schedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_schedules" DROP CONSTRAINT "FK_cleaning_schedules_rule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_users" DROP CONSTRAINT "FK_cleaning_rule_users_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_users" DROP CONSTRAINT "FK_cleaning_rule_users_rule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_resources" DROP CONSTRAINT "FK_cleaning_rule_resources_resource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rule_resources" DROP CONSTRAINT "FK_cleaning_rule_resources_rule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_rules" DROP CONSTRAINT "FK_cleaning_rules_studentClass"`,
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
    await queryRunner.query(`DROP TABLE "cleaning_rule_users"`);
    await queryRunner.query(`DROP TABLE "cleaning_rule_resources"`);
    await queryRunner.query(`DROP TABLE "cleaning_rules"`);
  }
}
