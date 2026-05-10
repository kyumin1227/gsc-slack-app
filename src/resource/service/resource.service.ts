import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resource, ResourceStatus, ResourceType } from '../resource.entity';
import { GoogleCalendarsService } from '../../google/calendar/calendars.service';
import { GoogleAclService } from '../../google/calendar/acl.service';
import { BusinessError, ResourceErrorCode } from '../../common/errors';
import { CreateResourceDto } from '../dto/resource.dto';

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    private readonly googleCalendarsService: GoogleCalendarsService,
    private readonly googleAclService: GoogleAclService,
  ) {}

  // Google Calendar 생성 후 리소스 DB 등록
  async create(dto: CreateResourceDto): Promise<Resource> {
    const { calendarId } = await this.googleCalendarsService.createCalendar(
      dto.name,
    );

    await this.googleAclService.makeCalendarPublic(calendarId);

    if (dto.isDefault) {
      await this.resourceRepository
        .createQueryBuilder()
        .update()
        .set({ isDefault: false })
        .where('1=1')
        .execute();
    }

    const resource = this.resourceRepository.create({
      name: dto.name,
      calendarId,
      type: dto.type ?? ResourceType.STUDY_ROOM,
      aliases: dto.aliases ?? [],
      description: dto.description,
      isDefault: dto.isDefault ?? false,
      status: ResourceStatus.ACTIVE,
    });
    return await this.resourceRepository.save(resource);
  }

  // 전체 리소스 조회 (onlyActive: 활성 상태만 필터)
  async findAll(onlyActive = false): Promise<Resource[]> {
    return this.resourceRepository.find({
      where: onlyActive ? { status: ResourceStatus.ACTIVE } : {},
      order: { name: 'ASC' },
    });
  }

  // 유형별 리소스 조회
  async findAllByType(
    type: ResourceType,
    onlyActive = false,
  ): Promise<Resource[]> {
    return this.resourceRepository.find({
      where: {
        type,
        ...(onlyActive ? { status: ResourceStatus.ACTIVE } : {}),
      },
      order: { name: 'ASC' },
    });
  }

  // ID로 단건 조회
  async findById(id: number): Promise<Resource | null> {
    return this.resourceRepository.findOne({ where: { id } });
  }

  // calendarId로 단건 조회
  async findByCalendarId(calendarId: string): Promise<Resource | null> {
    return this.resourceRepository.findOne({ where: { calendarId } });
  }

  // 기본 공간 조회 (alias 미매핑 이벤트 미러링 대상)
  async findDefault(): Promise<Resource | null> {
    return this.resourceRepository.findOne({ where: { isDefault: true } });
  }

  // 기본 공간 지정 (기존 기본 공간 해제 후 설정)
  async setDefault(id: number): Promise<void> {
    await this.resourceRepository
      .createQueryBuilder()
      .update()
      .set({ isDefault: false })
      .where('1=1')
      .execute();
    await this.resourceRepository.update(id, { isDefault: true });
  }

  // 기본 공간 해제
  async unsetDefault(id: number): Promise<void> {
    await this.resourceRepository.update(id, { isDefault: false });
  }

  // 이벤트 location 문자열로 alias 매핑 조회 (대소문자 무시)
  async findByAlias(location: string): Promise<Resource | null> {
    const lower = location.toLowerCase();
    const resources = await this.resourceRepository.find({
      where: { status: ResourceStatus.ACTIVE },
    });
    return (
      resources.find((r) =>
        r.aliases?.some((a) => a.toLowerCase() === lower),
      ) ?? null
    );
  }

  // 이름 변경 (Google Calendar 제목 동기화 포함)
  async rename(id: number, name: string): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ResourceErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleCalendarsService.updateCalendar(resource.calendarId, name);
    await this.resourceRepository.update(id, { name });
  }

  // 설명·상태·alias 등 메타 정보 수정
  async updateInfo(
    id: number,
    dto: {
      description?: string | null;
      status?: ResourceStatus;
      aliases?: string[];
      type?: ResourceType;
      bookingUrl?: string | null;
    },
  ): Promise<void> {
    await this.resourceRepository.update(id, dto as any);
  }

  // Google Calendar에 편집자 권한 부여
  async addEditor(id: number, email: string): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ResourceErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleAclService.shareCalendar({
      calendarId: resource.calendarId,
      email,
      role: 'writer',
    });
  }

  // Google Calendar 편집자 권한 회수
  async removeEditor(id: number, email: string): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ResourceErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleAclService.unshareCalendar(resource.calendarId, email);
  }

  // Google Calendar 삭제 후 소프트 딜리트
  async remove(id: number): Promise<void> {
    const resource = await this.findById(id);
    if (!resource) throw new BusinessError(ResourceErrorCode.STUDY_ROOM_NOT_FOUND);
    await this.googleCalendarsService.deleteCalendar(resource.calendarId);
    await this.resourceRepository.softDelete(id);
  }
}
