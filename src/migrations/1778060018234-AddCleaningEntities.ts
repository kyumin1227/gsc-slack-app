import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCleaningEntities1778060018234 implements MigrationInterface {
    name = 'AddCleaningEntities1778060018234'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."cleaning_schedules_status_enum" AS ENUM('예정', '완료', '취소')`);
        await queryRunner.query(`CREATE TABLE "cleaning_schedules" ("id" SERIAL NOT NULL, "cleaningDate" date NOT NULL, "status" "public"."cleaning_schedules_status_enum" NOT NULL DEFAULT '예정', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_08998f32756c241472e575bb8eb" UNIQUE ("cleaningDate"), CONSTRAINT "PK_522baef1b63673ee622738f84ec" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."cleaning_students_status_enum" AS ENUM('재학', '휴학')`);
        await queryRunner.query(`CREATE TABLE "cleaning_students" ("id" SERIAL NOT NULL, "userId" integer NOT NULL, "grade" integer NOT NULL, "status" "public"."cleaning_students_status_enum" NOT NULL DEFAULT '재학', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "REL_8854077b700306dd67109a604b" UNIQUE ("userId"), CONSTRAINT "PK_1f8e47e378e46352a78acf716d8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "cleaning_areas" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "needPeoples" integer NOT NULL, "targetGrades" integer array NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_cbfeb136df8ce70d5c08d0734a1" UNIQUE ("name"), CONSTRAINT "PK_631da6b2d740626cf6a57b65113" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."cleaning_assignments_status_enum" AS ENUM('배정', '완료', '취소', '불이행')`);
        await queryRunner.query(`CREATE TABLE "cleaning_assignments" ("id" SERIAL NOT NULL, "scheduleId" integer NOT NULL, "studentId" integer NOT NULL, "areaId" integer NOT NULL, "status" "public"."cleaning_assignments_status_enum" NOT NULL DEFAULT '배정', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_ff224d7c4384622ad7c71647987" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."cleaning_trades_status_enum" AS ENUM('대기', '수락', '거절', '취소')`);
        await queryRunner.query(`CREATE TABLE "cleaning_trades" ("id" SERIAL NOT NULL, "requesterAssignmentId" integer NOT NULL, "targetAssignmentId" integer NOT NULL, "status" "public"."cleaning_trades_status_enum" NOT NULL DEFAULT '대기', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_2145923e043b8d7b9b639a01d49" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "resource" ALTER COLUMN "name" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "resource" ALTER COLUMN "calendarId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "cleaning_students" ADD CONSTRAINT "FK_8854077b700306dd67109a604bc" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "FK_0b5bb48bf734810e2738baf7f7a" FOREIGN KEY ("scheduleId") REFERENCES "cleaning_schedules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "FK_42ea819fed40960a6aa464b1799" FOREIGN KEY ("studentId") REFERENCES "cleaning_students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "FK_6e63076ebfbe7858a83c5788b30" FOREIGN KEY ("areaId") REFERENCES "cleaning_areas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cleaning_trades" ADD CONSTRAINT "FK_da8a42514208d44f04c637686d8" FOREIGN KEY ("requesterAssignmentId") REFERENCES "cleaning_assignments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cleaning_trades" ADD CONSTRAINT "FK_39889f2775dec138a5c8a8dc308" FOREIGN KEY ("targetAssignmentId") REFERENCES "cleaning_assignments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cleaning_trades" DROP CONSTRAINT "FK_39889f2775dec138a5c8a8dc308"`);
        await queryRunner.query(`ALTER TABLE "cleaning_trades" DROP CONSTRAINT "FK_da8a42514208d44f04c637686d8"`);
        await queryRunner.query(`ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "FK_6e63076ebfbe7858a83c5788b30"`);
        await queryRunner.query(`ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "FK_42ea819fed40960a6aa464b1799"`);
        await queryRunner.query(`ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "FK_0b5bb48bf734810e2738baf7f7a"`);
        await queryRunner.query(`ALTER TABLE "cleaning_students" DROP CONSTRAINT "FK_8854077b700306dd67109a604bc"`);
        await queryRunner.query(`ALTER TABLE "resource" ALTER COLUMN "calendarId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "resource" ALTER COLUMN "name" DROP NOT NULL`);
        await queryRunner.query(`DROP TABLE "cleaning_trades"`);
        await queryRunner.query(`DROP TYPE "public"."cleaning_trades_status_enum"`);
        await queryRunner.query(`DROP TABLE "cleaning_assignments"`);
        await queryRunner.query(`DROP TYPE "public"."cleaning_assignments_status_enum"`);
        await queryRunner.query(`DROP TABLE "cleaning_areas"`);
        await queryRunner.query(`DROP TABLE "cleaning_students"`);
        await queryRunner.query(`DROP TYPE "public"."cleaning_students_status_enum"`);
        await queryRunner.query(`DROP TABLE "cleaning_schedules"`);
        await queryRunner.query(`DROP TYPE "public"."cleaning_schedules_status_enum"`);
    }

}
