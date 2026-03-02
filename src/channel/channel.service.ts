import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ScheduleChannel } from './schedule-channel.entity';
import { StudentClass } from '../student-class/student-class.entity';

@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(ScheduleChannel)
    private scheduleChannelRepository: Repository<ScheduleChannel>,
    @InjectRepository(StudentClass)
    private studentClassRepository: Repository<StudentClass>,
  ) {}

  // 시간표에 연결된 Slack 채널 ID 목록 조회
  async getSlackChannelIds(scheduleId: number): Promise<string[]> {
    const records = await this.scheduleChannelRepository.find({
      where: { scheduleId },
    });
    return records.map((r) => r.slackChannelId);
  }

  // 시간표 채널 목록 전체 교체 (multi_channels_select 저장 시)
  async setScheduleChannels(
    scheduleId: number,
    slackChannelIds: string[],
  ): Promise<void> {
    await this.scheduleChannelRepository.delete({ scheduleId });

    if (slackChannelIds.length === 0) return;

    const records = slackChannelIds.map((slackChannelId) =>
      this.scheduleChannelRepository.create({ scheduleId, slackChannelId }),
    );
    await this.scheduleChannelRepository.save(records);
  }

  // studentClassId 목록으로 해당 반들의 Slack 채널 ID 조회
  async getClassSlackChannelIds(studentClassIds: number[]): Promise<string[]> {
    if (studentClassIds.length === 0) return [];
    const classes = await this.studentClassRepository.find({
      where: { id: In(studentClassIds) },
    });
    return classes
      .map((c) => c.slackChannelId)
      .filter((id): id is string => !!id);
  }

  // 학급 태그의 studentClassId 목록 기반 채널 자동 동기화 (merge, 삭제 없음)
  async syncClassChannels(
    scheduleId: number,
    studentClassIds: number[],
  ): Promise<void> {
    if (studentClassIds.length === 0) return;

    const classes = await this.studentClassRepository.find({
      where: { id: In(studentClassIds) },
    });

    const channelIds = classes
      .map((c) => c.slackChannelId)
      .filter((id): id is string => !!id);

    if (channelIds.length === 0) return;

    const existing = await this.getSlackChannelIds(scheduleId);
    const toAdd = channelIds.filter((id) => !existing.includes(id));

    if (toAdd.length === 0) return;

    const records = toAdd.map((slackChannelId) =>
      this.scheduleChannelRepository.create({ scheduleId, slackChannelId }),
    );
    await this.scheduleChannelRepository.save(records);
  }
}
