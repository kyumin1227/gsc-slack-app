import { MigrationInterface, QueryRunner } from 'typeorm';

export class SpaceToResource1776600000000 implements MigrationInterface {
  name = 'SpaceToResource1776600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 새 enum 타입 생성
    await queryRunner.query(
      `CREATE TYPE "public"."resource_type_enum" AS ENUM('classroom', 'study_room', 'professor')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."resource_status_enum" AS ENUM('active', 'inactive')`,
    );

    // 2. resource 테이블 생성 — space 데이터 복사
    await queryRunner.query(`CREATE TABLE "resource" AS SELECT * FROM "space"`);

    // 3. type 컬럼: text로 임시 변환 후 새 enum 적용
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "type" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "type" TYPE "public"."resource_type_enum" USING "type"::"public"."resource_type_enum"`,
    );

    // 4. status 컬럼: text로 임시 변환 후 새 enum 적용
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "status" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "status" TYPE "public"."resource_status_enum" USING "status"::"public"."resource_status_enum"`,
    );

    // 5. 제약 조건 및 인덱스 복원 + NOT NULL / DEFAULT 복원 (AS SELECT가 제거함)
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "createdAt" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "createdAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "updatedAt" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "updatedAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "status" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "type" SET DEFAULT 'study_room'`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "type" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "isDefault" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "isDefault" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ADD CONSTRAINT "PK_resource" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS "resource_id_seq" OWNED BY "resource"."id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ALTER COLUMN "id" SET DEFAULT nextval('resource_id_seq')`,
    );
    await queryRunner.query(
      `SELECT setval('resource_id_seq', COALESCE((SELECT MAX(id) FROM "resource"), 0) + 1, false)`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource" ADD CONSTRAINT "UQ_resource_calendarId" UNIQUE ("calendarId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_default_resource" ON "resource" ("isDefault") WHERE "isDefault" = true`,
    );

    // 7. 기존 space 테이블 및 관련 인덱스 삭제
    await queryRunner.query(`DROP INDEX IF EXISTS "unique_default_space"`);
    await queryRunner.query(`DROP TABLE "space"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."space_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."space_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 역방향: resource → space (professor 행 제외)

    await queryRunner.query(
      `CREATE TYPE "public"."space_type_enum" AS ENUM('classroom', 'study_room')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."space_status_enum" AS ENUM('active', 'inactive')`,
    );

    await queryRunner.query(
      `CREATE TABLE "space" AS SELECT id, name, aliases, "calendarId", type::text::"public"."space_type_enum", description, status::text::"public"."space_status_enum", "isDefault", "createdAt", "updatedAt", "deletedAt" FROM "resource" WHERE type != 'professor'`,
    );

    await queryRunner.query(
      `ALTER TABLE "space" ADD CONSTRAINT "PK_space" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "space" ADD CONSTRAINT "UQ_26d056e88f6bbd59a3c6ddb3e21" UNIQUE ("calendarId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_default_space" ON "space" ("isDefault") WHERE "isDefault" = true`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "unique_default_resource"`);
    await queryRunner.query(`DROP TABLE "resource"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."resource_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."resource_status_enum"`,
    );
  }
}
