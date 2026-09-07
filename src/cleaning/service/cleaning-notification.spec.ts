import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { ScheduleModule } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SlackService } from 'nestjs-slack-bolt';
import { CleaningAssignment } from '../entity/cleaning-assignment.entity';
import { CleaningNotificationService } from './cleaning-notification.service';

describe('CleaningNotificationService', () => {
  let service: CleaningNotificationService;
  let module: TestingModule;
  const query = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
  const postMessage = jest.fn<
    Promise<{ ok: boolean }>,
    [{ channel: string; text: string }]
  >();
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T00:00:00Z'));
    query.getRawMany.mockResolvedValue([]);
    postMessage.mockReset().mockResolvedValue({ ok: true });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CleaningNotificationService,
        {
          provide: getRepositoryToken(CleaningAssignment),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(query) },
        },
        {
          provide: SlackService,
          useValue: { client: { chat: { postMessage } } },
        },
      ],
    }).compile();
    service = module.get(CleaningNotificationService);
  });

  afterEach(async () => {
    await module.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('매일 한국 시간 오전 9시에 실행하도록 등록한다', () => {
    const handler = Reflect.get(
      service,
      'sendDailyReminders',
    ) as () => Promise<void>;
    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, handler)).toMatchObject({
      cronTime: '0 9 * * *',
      timeZone: 'Asia/Seoul',
      waitForCompletion: true,
    });
  });
});
