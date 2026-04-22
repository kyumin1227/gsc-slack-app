import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1776589071378 implements MigrationInterface {
  name = 'InitialSchema1776589071378';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."student_class_section_enum" AS ENUM('A', 'B')`);
    await queryRunner.query(`CREATE TYPE "public"."student_class_status_enum" AS ENUM('active', 'graduated')`);
    await queryRunner.query(`CREATE TYPE "public"."user_status_enum" AS ENUM('registered', 'pending_approval', 'active', 'inactive')`);
    await queryRunner.query(`CREATE TYPE "public"."user_role_enum" AS ENUM('professor', 'ta', 'class_rep', 'key_keeper', 'student')`);
    await queryRunner.query(`CREATE TYPE "public"."tag_status_enum" AS ENUM('active', 'inactive')`);
    await queryRunner.query(`CREATE TYPE "public"."space_type_enum" AS ENUM('classroom', 'study_room')`);
    await queryRunner.query(`CREATE TYPE "public"."space_status_enum" AS ENUM('active', 'inactive')`);
    await queryRunner.query(`CREATE TYPE "public"."schedule_status_enum" AS ENUM('active', 'inactive')`);
    await queryRunner.query(
      `CREATE TABLE "student_class" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "admissionYear" integer NOT NULL, "section" "public"."student_class_section_enum" NOT NULL, "status" "public"."student_class_status_enum" NOT NULL DEFAULT 'active', "graduationYear" integer NOT NULL, "slackChannelId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_429404a1cfd2f46c3830fd635ce" UNIQUE ("name"), CONSTRAINT "UQ_52382e22a97e36b6f6c3d1c8fff" UNIQUE ("admissionYear", "section"), CONSTRAINT "PK_85874ee23f2927b59ff5f769f3c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" SERIAL NOT NULL, "slackId" character varying NOT NULL, "email" character varying NOT NULL, "name" character varying NOT NULL, "code" character varying, "role" "public"."user_role_enum", "studentClassId" integer, "refreshToken" character varying, "status" "public"."user_status_enum" NOT NULL DEFAULT 'registered', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_844098308ecb5168105cffa9baa" UNIQUE ("slackId"), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "tag" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "status" "public"."tag_status_enum" NOT NULL DEFAULT 'active', "studentClassId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_6a9775008add570dc3e5a0bab7b" UNIQUE ("name"), CONSTRAINT "REL_629d7670ef2b701f5caee43ba4" UNIQUE ("studentClassId"), CONSTRAINT "PK_8e4052373c579afc1471f526760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "space" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "aliases" text, "calendarId" character varying NOT NULL, "type" "public"."space_type_enum" NOT NULL DEFAULT 'study_room', "description" character varying, "status" "public"."space_status_enum" NOT NULL DEFAULT 'active', "isDefault" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_26d056e88f6bbd59a3c6ddb3e21" UNIQUE ("calendarId"), CONSTRAINT "PK_094f5ec727fe052956a11623640" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_default_space" ON "space" ("isDefault") WHERE "isDefault" = true`,
    );
    await queryRunner.query(
      `CREATE TABLE "schedule" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "calendarId" character varying NOT NULL, "description" character varying, "status" "public"."schedule_status_enum" NOT NULL DEFAULT 'active', "createdById" integer NOT NULL, "watchChannelId" character varying, "watchResourceId" character varying, "syncToken" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_f37c379e70edf58cc1ed63c97aa" UNIQUE ("calendarId"), CONSTRAINT "PK_1c05e42aec7371641193e180046" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "recurrence_group" ("id" SERIAL NOT NULL, "groupId" character varying NOT NULL, "title" character varying NOT NULL, "daysOfWeek" text, "location" character varying, "startTime" character varying NOT NULL, "endTime" character varying NOT NULL, "recurrenceType" character varying NOT NULL, "startDate" character varying NOT NULL, "endDate" character varying NOT NULL, "scheduleId" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_5af0c89d5c2472de56cd74c4afb" UNIQUE ("groupId"), CONSTRAINT "PK_7d166d2a6fe9fbee27385ce0b20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "schedule_channel" ("id" SERIAL NOT NULL, "scheduleId" integer NOT NULL, "slackChannelId" character varying NOT NULL, CONSTRAINT "UQ_be1f13dbe1c600208de37f92fdd" UNIQUE ("scheduleId", "slackChannelId"), CONSTRAINT "PK_aabf66e4bc1a3254e7506f3a6e4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "schedule_tag" ("scheduleId" integer NOT NULL, "tagId" integer NOT NULL, CONSTRAINT "PK_19501b9946de264410b150e5737" PRIMARY KEY ("scheduleId", "tagId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a9f38084fc64e658f3059f303" ON "schedule_tag" ("scheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_37f21dc2c8ac3c073611b3e877" ON "schedule_tag" ("tagId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "FK_c6e43804df78ffe918c527fcd89" FOREIGN KEY ("studentClassId") REFERENCES "student_class"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tag" ADD CONSTRAINT "FK_629d7670ef2b701f5caee43ba43" FOREIGN KEY ("studentClassId") REFERENCES "student_class"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule" ADD CONSTRAINT "FK_9c94e97526c0fc1a4d4a45af773" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurrence_group" ADD CONSTRAINT "FK_920fad96b4003909790319ec409" FOREIGN KEY ("scheduleId") REFERENCES "schedule"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_channel" ADD CONSTRAINT "FK_963e78a92f96e038813b60c78d4" FOREIGN KEY ("scheduleId") REFERENCES "schedule"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_tag" ADD CONSTRAINT "FK_0a9f38084fc64e658f3059f303d" FOREIGN KEY ("scheduleId") REFERENCES "schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_tag" ADD CONSTRAINT "FK_37f21dc2c8ac3c073611b3e8770" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schedule_tag" DROP CONSTRAINT "FK_37f21dc2c8ac3c073611b3e8770"`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_tag" DROP CONSTRAINT "FK_0a9f38084fc64e658f3059f303d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_channel" DROP CONSTRAINT "FK_963e78a92f96e038813b60c78d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurrence_group" DROP CONSTRAINT "FK_920fad96b4003909790319ec409"`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule" DROP CONSTRAINT "FK_9c94e97526c0fc1a4d4a45af773"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tag" DROP CONSTRAINT "FK_629d7670ef2b701f5caee43ba43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "FK_c6e43804df78ffe918c527fcd89"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_37f21dc2c8ac3c073611b3e877"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a9f38084fc64e658f3059f303"`,
    );
    await queryRunner.query(`DROP TABLE "schedule_tag"`);
    await queryRunner.query(`DROP TABLE "schedule_channel"`);
    await queryRunner.query(`DROP TABLE "recurrence_group"`);
    await queryRunner.query(`DROP TABLE "schedule"`);
    await queryRunner.query(`DROP INDEX "public"."unique_default_space"`);
    await queryRunner.query(`DROP TABLE "space"`);
    await queryRunner.query(`DROP TABLE "tag"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TABLE "student_class"`);
    await queryRunner.query(`DROP TYPE "public"."schedule_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."space_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."space_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."tag_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
    await queryRunner.query(`DROP TYPE "public"."user_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."student_class_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."student_class_section_enum"`);
  }
}
