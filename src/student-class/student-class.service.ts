import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  StudentClass,
  StudentClassStatus,
  ClassSection,
} from './student-class.entity';
import { TagService } from '../tag/tag.service';

export interface CreateStudentClassDto {
  admissionYear: number;
  section: ClassSection;
  graduationYear: number;
}

@Injectable()
export class StudentClassService {
  constructor(
    @InjectRepository(StudentClass)
    private studentClassRepository: Repository<StudentClass>,
    private tagService: TagService,
  ) {}

  // 반 이름 자동 생성: "${admissionYear}-${section}" (예: "2024-A")
  static buildClassName(admissionYear: number, section: ClassSection): string {
    return `${admissionYear}-${section}`;
  }

  // Slack 채널명 생성: "${admissionYear}-${section.toLowerCase()}" (예: "2024-a")
  static buildChannelName(admissionYear: number, section: ClassSection): string {
    return `${admissionYear}-${section.toLowerCase()}`;
  }

  // 반 생성 + 태그 자동 생성
  async createClass(dto: CreateStudentClassDto): Promise<StudentClass> {
    const name = StudentClassService.buildClassName(dto.admissionYear, dto.section);
    const studentClass = this.studentClassRepository.create({
      name,
      admissionYear: dto.admissionYear,
      section: dto.section,
      graduationYear: dto.graduationYear,
      status: StudentClassStatus.ACTIVE,
    });
    const savedClass = await this.studentClassRepository.save(studentClass);

    // 태그 자동 생성
    await this.tagService.createTagForClass(savedClass.id, savedClass.name);

    return savedClass;
  }

  // 활성 상태인 반 목록 조회
  async findActiveClasses(): Promise<StudentClass[]> {
    return this.studentClassRepository.find({
      where: { status: StudentClassStatus.ACTIVE },
      order: { name: 'ASC' },
    });
  }

  // 모든 반 목록 조회 (관리용)
  async findAllClasses(): Promise<StudentClass[]> {
    return this.studentClassRepository.find({
      order: { status: 'ASC', name: 'ASC' },
    });
  }

  async findById(id: number): Promise<StudentClass | null> {
    return this.studentClassRepository.findOne({ where: { id } });
  }

  // 반에 Slack 채널 ID 저장
  async updateSlackChannel(
    id: number,
    slackChannelId: string,
  ): Promise<void> {
    await this.studentClassRepository.update({ id }, { slackChannelId });
  }

  // 반 활성화 (졸업 취소)
  async activateClass(id: number): Promise<StudentClass | null> {
    await this.studentClassRepository.update(
      { id },
      { status: StudentClassStatus.ACTIVE },
    );

    // 연결된 태그도 활성화
    const tag = await this.tagService.findByStudentClassId(id);
    if (tag) {
      await this.tagService.activateTag(tag.id);
    }

    return this.findById(id);
  }

  // 반 졸업 처리
  async graduateClass(id: number): Promise<StudentClass | null> {
    await this.studentClassRepository.update(
      { id },
      { status: StudentClassStatus.GRADUATED },
    );

    // 연결된 태그도 비활성화
    const tag = await this.tagService.findByStudentClassId(id);
    if (tag) {
      await this.tagService.deactivateTag(tag.id);
    }

    return this.findById(id);
  }

  // 반 삭제 (soft delete)
  async deleteClass(id: number): Promise<void> {
    await this.studentClassRepository.softDelete({ id });

    // 연결된 태그도 삭제
    const tag = await this.tagService.findByStudentClassId(id);
    if (tag) {
      await this.tagService.deleteTag(tag.id);
    }
  }
}
