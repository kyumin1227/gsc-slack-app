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

  it('9시 전에는 보내지 않고 매일 한국 시간 9시에 한 번씩 자동 실행한다', async () => {
    jest.setSystemTime(new Date('2026-09-06T23:59:59Z')); // 한국 시간 08:59:59
    query.getRawMany.mockResolvedValue([
      { assignmentId: 1, userSlackId: 'U_FIRST', resourceName: '스터디룸' },
    ]);
    // 실제 NestJS Cron만 시작한다. DB와 Slack은 가짜 구현을 사용한다.
    await module.init();

    await jest.advanceTimersByTimeAsync(999); // 08:59:59.999
    expect(query.getRawMany).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1); // 09:00:00
    expect(query.getRawMany).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].channel).toBe('U_FIRST');
    expect(postMessage.mock.calls[0][0].text).toContain('2026-09-07');

    await jest.advanceTimersByTimeAsync(60_000); // 09:01:00
    expect(postMessage).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 60_000 - 1);
    expect(postMessage).toHaveBeenCalledTimes(1); // 다음 날 08:59:59.999

    await jest.advanceTimersByTimeAsync(1); // 다음 날 09:00:00
    expect(query.getRawMany).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(query.where).toHaveBeenLastCalledWith('s.cleaningDate = :today', {
      today: '2026-09-08',
    });
    expect(postMessage.mock.calls[1][0].text).toContain('2026-09-08');
  });

  it.each([
    ['2026-09-06T14:59:59Z', '2026-09-06'],
    ['2026-09-06T15:00:00Z', '2026-09-07'],
    ['2026-09-07T00:00:00Z', '2026-09-07'],
  ])('서버 시각 %s에서도 한국 날짜 %s로 조회한다', async (now, today) => {
    jest.setSystemTime(new Date(now));

    await service.sendDailyReminders();

    expect(query.where).toHaveBeenCalledWith('s.cleaningDate = :today', {
      today,
    });
    expect(query.andWhere).toHaveBeenCalledWith('s.status = :scheduleStatus', {
      scheduleStatus: '예정',
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'a.status = :assignmentStatus',
      {
        assignmentStatus: '배정',
      },
    );
    expect(query.andWhere).toHaveBeenCalledWith('u.status = :userStatus', {
      userStatus: 'active',
    });
    expect(query.andWhere).toHaveBeenCalledWith('r.deletedAt IS NULL');
  });

  it('조회된 현재 담당자 각각에게 날짜와 청소 구역을 안내한다', async () => {
    query.getRawMany.mockResolvedValue([
      { assignmentId: 1, userSlackId: 'U_FIRST', resourceName: '스터디룸' },
      { assignmentId: 2, userSlackId: 'U_REPLACEMENT', resourceName: '강의실' },
    ]);

    await service.sendDailyReminders();

    expect(postMessage.mock.calls.map(([message]) => message.channel)).toEqual([
      'U_FIRST',
      'U_REPLACEMENT',
    ]);
    expect(postMessage.mock.calls[0][0].text).toContain('2026-09-07');
    expect(postMessage.mock.calls[0][0].text).toContain('스터디룸');
    expect(postMessage.mock.calls[1][0].text).toContain('강의실');
  });

  it('당일 대상자가 없으면 전송 함수를 호출하지 않는다', async () => {
    await service.sendDailyReminders();

    expect(postMessage).not.toHaveBeenCalled();
  });
});
