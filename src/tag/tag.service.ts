import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag, TagStatus } from './tag.entity';

export interface CreateTagDto {
  name: string;
  studentClassId?: number;
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
      order: { name: 'ASC' },
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
}
