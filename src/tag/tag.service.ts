import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag, TagStatus } from './tag.entity';
import { StudentClassStatus } from '../student-class/student-class.entity';

export interface CreateTagDto {
  name: string;
  studentClassId?: number;
}

export interface TagDisplayItem {
  id: number;
  name: string;
  status: TagStatus;
  isClassTag: boolean;
}

@Injectable()
export class TagService {
  constructor(
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
  ) {}

  // 태그 생성 (수동)
  async createTag(dto: CreateTagDto): Promise<Tag> {
    const tag = this.tagRepository.create({
      ...dto,
      status: TagStatus.ACTIVE,
    });
    return this.tagRepository.save(tag);
  }

  // 반 생성 시 자동으로 태그 생성
  async createTagForClass(
    studentClassId: number,
    className: string,
  ): Promise<Tag> {
    const tag = this.tagRepository.create({
      name: className,
      studentClassId,
      status: TagStatus.ACTIVE,
    });
    return this.tagRepository.save(tag);
  }

  async findById(id: number): Promise<Tag | null> {
    return this.tagRepository.findOne({ where: { id } });
  }

  async findByName(name: string): Promise<Tag | null> {
    return this.tagRepository.findOne({ where: { name } });
  }

  async findByStudentClassId(studentClassId: number): Promise<Tag | null> {
    return this.tagRepository.findOne({ where: { studentClassId } });
  }

  // 활성 태그 목록 조회
  async findActiveTags(): Promise<Tag[]> {
    return this.tagRepository.find({
      where: { status: TagStatus.ACTIVE },
      relations: ['studentClass'],
      order: { name: 'ASC' },
    });
  }

  // 모든 태그 목록 조회 (관리용)
  async findAllTags(): Promise<Tag[]> {
    return this.tagRepository.find({
      relations: ['studentClass'],
      order: { status: 'ASC', name: 'ASC' },
    });
  }

  // 태그 비활성화
  async deactivateTag(id: number): Promise<Tag | null> {
    await this.tagRepository.update({ id }, { status: TagStatus.INACTIVE });
    return this.findById(id);
  }

  // 태그 활성화
  async activateTag(id: number): Promise<Tag | null> {
    await this.tagRepository.update({ id }, { status: TagStatus.ACTIVE });
    return this.findById(id);
  }

  // 태그 삭제 (soft delete)
  async deleteTag(id: number): Promise<void> {
    await this.tagRepository.softDelete({ id });
  }

  // 표시용 태그 목록 조회 (학년 정보 포함)
  async findDisplayTags(activeOnly = false): Promise<TagDisplayItem[]> {
    const tags = activeOnly
      ? await this.findActiveTags()
      : await this.findAllTags();
    return tags.map((t) => ({
      id: t.id,
      name: TagService.buildDisplayName(t),
      status: t.status,
      isClassTag: t.studentClassId !== null,
    }));
  }

  // 표시용 이름 생성 (반 태그에 학년 정보 추가)
  static buildDisplayName(tag: Tag): string {
    if (!tag.studentClass) return tag.name;
    if (tag.studentClass.status === StudentClassStatus.GRADUATED) {
      return `${tag.name} (졸업)`;
    }
    const grade = new Date().getFullYear() - tag.studentClass.admissionYear + 1;
    return `${tag.name} (${grade}학년)`;
  }
}
