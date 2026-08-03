import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Announcement } from './announcement.entity';
import { User } from '../user/user.entity';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/create-announcement.dto';

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(Announcement)
    private readonly announcementRepository: Repository<Announcement>,
  ) {}

  /** 페이지 단위 공지 조회 (author 포함) */
  async findPage(
    offset: number,
    limit: number,
  ): Promise<{ items: Announcement[]; total: number }> {
    const [items, total] = await this.announcementRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
      relations: { author: true },
    });
    return { items, total };
  }

  /** 단일 공지 조회 */
  async findOne(id: number): Promise<Announcement | null> {
    return this.announcementRepository.findOne({
      where: { id },
      relations: { author: true },
    });
  }

  /** 공지 생성 */
  async create(dto: CreateAnnouncementDto): Promise<Announcement> {
    const announcement = this.announcementRepository.create({
      channelId: dto.channelId,
      messageTs: dto.messageTs,
      title: dto.title,
      content: dto.content,
      author: { id: dto.authorId } as unknown as User,
    });
    return this.announcementRepository.save(announcement);
  }

  /** 공지 수정 (제목·내용만) */
  async update(id: number, dto: UpdateAnnouncementDto): Promise<void> {
    await this.announcementRepository.update(id, {
      title: dto.title,
      content: dto.content,
    });
  }

  /** 공지 소프트 삭제 */
  async softDelete(id: number): Promise<void> {
    await this.announcementRepository.softDelete(id);
  }
}
