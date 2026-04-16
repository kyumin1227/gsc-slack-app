import { Controller } from '@nestjs/common';
import { Action, Command, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ScheduleService } from './schedule.service';
import { ScheduleView } from './schedule.view';
import { UserService } from '../user/user.service';
import { TagService } from '../tag/tag.service';
import { TagView } from '../tag/tag.view';
import { ChannelService } from '../channel/channel.service';
import { UserStatus, User } from '../user/user.entity';
import { CMD } from '../common/slack-commands';
import { PermissionService } from '../user/permission.service';
import { GoogleCalendarService } from '../google/google-calendar.service';

const CALENDAR_COLORS = [
  '%234285F4',
  '%23DB4437',
  '%230F9D58',
  '%23F4B400',
  '%239E69AF',
  '%23F6511D',
  '%2300BCD4',
  '%23E91E63',
  '%23795548',
  '%23607D8B',
  '%23FF5722',
  '%239C27B0',
  '%2303A9F4',
  '%238BC34A',
  '%23FF9800',
];

@Controller()
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly userService: UserService,
    private readonly tagService: TagService,
    private readonly channelService: ChannelService,
    private readonly permissionService: PermissionService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  // 활성 사용자 확인 헬퍼
  private async checkActiveUser(
    slackUserId: string,
  ): Promise<{ isActive: boolean; user?: User; message?: string }> {
    const user = await this.userService.findBySlackId(slackUserId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      return {
        isActive: false,
        message:
          '활성화된 사용자만 이용 가능합니다. 먼저 회원가입을 완료해주세요.',
      };
    }
    return { isActive: true, user };
  }

  private readonly SCHEDULE_PAGE_SIZE = 10;

  // 목록 모달 빌드 헬퍼
  private async buildListModal(page: number, status: string, tagIds: number[]) {
    const statusFilter =
      status === 'all' ? undefined : (status as 'active' | 'inactive');
    const tagFilter = tagIds.length > 0 ? tagIds : undefined;

    const [{ schedules, total }, displayTags] = await Promise.all([
      this.scheduleService.findSchedulesPaginated({
        page,
        pageSize: this.SCHEDULE_PAGE_SIZE,
        status: statusFilter,
        tagIds: tagFilter,
      }),
      this.tagService.findDisplayTags(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / this.SCHEDULE_PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);

    const displayTagMap = new Map(displayTags.map((t) => [t.id, t.name]));

    const schedulesWithMeta = await Promise.all(
      schedules.map(async (s) => {
        const [channels, acl] = await Promise.all([
          this.channelService.getSlackChannelIds(s.id),
          this.googleCalendarService
            .getCalendarAcl(s.calendarId)
            .catch(() => []),
        ]);

        const writerEmails = acl
          .filter((e) => e.role === 'writer' || e.role === 'owner')
          .map((e) => e.email);
        const writers =
          await this.userService.mapEmailsToSlackIds(writerEmails);

        return {
          id: s.id,
          name: s.name,
          description: s.description,
          status: s.status,
          tags: s.tags.map((t) => ({
            id: t.id,
            name: displayTagMap.get(t.id) ?? t.name,
          })),
          createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
          channels,
          writers,
          createdAt: s.createdAt,
        };
      }),
    );

    return ScheduleView.listModal(schedulesWithMeta, displayTags, {
      page: safePage,
      totalPages,
      total,
      selectedStatus: status,
      selectedTagIds: tagIds,
    });
  }

  // /시간표 - 시간표 목록 조회
  @Command(CMD.시간표)
  @Action('home:open-schedule-list')
  async listSchedules({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: await this.buildListModal(0, 'all', []),
    });
  }

  // /시간표생성 - 시간표 생성 모달
  @Command(CMD.시간표생성)
  @Action('home:open-create-schedule')
  async openCreateModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    const tags = await this.tagService.findDisplayTags();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.createModal(tags),
    });
  }

  // 시간표 생성 폼 제출
  @View('schedule:modal:create')
  async handleCreate({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const name = values.name_block.name_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const selectedTags = values.tags_block?.tags_input?.selected_options ?? [];

    // 빠른 유효성 검사 (ack 전)
    if (!name.trim()) {
      await ack({
        response_action: 'errors',
        errors: { name_block: '과목명을 입력해주세요.' },
      });
      return;
    }

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) {
      await ack({
        response_action: 'errors',
        errors: { name_block: '사용자 정보를 찾을 수 없습니다.' },
      });
      return;
    }

    // 3초 제한 내에 ack 처리 — 이후 작업은 DM으로 결과 전달
    await ack();

    const tagIds = selectedTags.map((opt: { value: string }) =>
      parseInt(opt.value, 10),
    );

    const creatorRefreshToken = this.userService.getDecryptedRefreshToken(user);

    const created = await this.scheduleService.createSchedule({
      name: name.trim(),
      description: description?.trim(),
      tagIds,
      createdById: user.id,
      creatorEmail: user.email,
      creatorRefreshToken: creatorRefreshToken ?? undefined,
    });

    // 학반 태그 기반 알림 채널 자동 등록
    const studentClassIds = (created.tags ?? [])
      .filter((t) => t.studentClassId)
      .map((t) => t.studentClassId!);
    await this.channelService.syncClassChannels(created.id, studentClassIds);

    await client.chat.postMessage({
      channel: body.user.id,
      text: `시간표 "${name}"이(가) 생성되었습니다. Google Calendar가 함께 생성되었습니다.`,
    });

    logger.info(`Schedule created: ${name} by ${user.name}`);
  }

  // 시간표 상태 토글 (활성화/비활성화)
  @Action(/^schedule:list:toggle:/)
  async handleToggle({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string; value: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
    const toggleAction = action.value;

    if (toggleAction === 'deactivate') {
      await this.scheduleService.deactivateSchedule(scheduleId);
    } else if (toggleAction === 'activate') {
      await this.scheduleService.activateSchedule(scheduleId);
    }

    // 현재 필터/페이지 유지하며 목록 새로고침
    if (body.view?.id) {
      const meta = JSON.parse(body.view.private_metadata || '{}') as {
        page?: number;
        status?: string;
        tagIds?: number[];
      };
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildListModal(
          meta.page ?? 0,
          meta.status ?? 'all',
          meta.tagIds ?? [],
        ),
      });
    }

    logger.info(`Schedule ${scheduleId} toggled to ${toggleAction}`);
  }

  // 조회 버튼(submit) → 필터 적용, 모달 유지
  @View('schedule:modal:list')
  async handleSearch({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const status =
      values['status_block']?.['status_select']?.selected_option?.value ??
      'all';
    const tagIds = (
      values['tags_block']?.['tags_select']?.selected_options ?? []
    ).map((opt: { value: string }) => parseInt(opt.value, 10));

    await ack({
      response_action: 'update',
      view: await this.buildListModal(0, status, tagIds),
    });
  }

  // 페이지 이동 버튼
  @Action(/^schedule:list:page:/)
  async handlePageChange({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { value: string };
    const page = parseInt(action.value, 10);
    const meta = JSON.parse(body.view?.private_metadata || '{}') as {
      status?: string;
      tagIds?: number[];
    };

    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildListModal(
          page,
          meta.status ?? 'all',
          meta.tagIds ?? [],
        ),
      });
    }
  }

  // /구독 - 시간표 구독 (태그 선택)
  @Command(CMD.구독)
  @Action('home:open-subscribe')
  async openSubscribeModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;

    const { isActive, message } = await this.checkActiveUser(userId);
    if (!isActive) {
      if ('channel_id' in body) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: userId,
          text: message!,
        });
      }
      return;
    }

    const tags = await this.tagService.findDisplayTags();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.subscribeSearchModal(tags),
    });
  }

  // 구독 모달 빌드 헬퍼 (활성 태그만, 구독 여부 포함)
  private async buildSubscribeModal(
    page: number,
    tagIds: number[],
    userRefreshToken: string,
  ) {
    const tagFilter = tagIds.length > 0 ? tagIds : undefined;

    const [{ schedules, total }, displayActiveTags, subscribedIds] =
      await Promise.all([
        this.scheduleService.findSchedulesPaginated({
          page,
          pageSize: this.SCHEDULE_PAGE_SIZE,
          status: 'active',
          tagIds: tagFilter,
        }),
        this.tagService.findDisplayTags(true),
        this.scheduleService.getSubscribedCalendarIds(userRefreshToken),
      ]);

    const totalPages = Math.max(1, Math.ceil(total / this.SCHEDULE_PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const displayActiveTagMap = new Map(
      displayActiveTags.map((t) => [t.id, t.name]),
    );

    const schedulesWithSubscription = await Promise.all(
      schedules.map(async (s) => {
        const [channels, acl] = await Promise.all([
          this.channelService.getSlackChannelIds(s.id),
          this.googleCalendarService
            .getCalendarAcl(s.calendarId)
            .catch(() => []),
        ]);

        const writerEmails = acl
          .filter((e) => e.role === 'writer' || e.role === 'owner')
          .map((e) => e.email);
        const writers =
          await this.userService.mapEmailsToSlackIds(writerEmails);

        return {
          id: s.id,
          name: s.name,
          description: s.description,
          calendarId: s.calendarId,
          tags: s.tags.map((t) => ({
            id: t.id,
            name: displayActiveTagMap.get(t.id) ?? t.name,
          })),
          channels,
          writers,
          isSubscribed: subscribedIds.has(s.calendarId),
        };
      }),
    );

    return ScheduleView.subscribeSearchModal(
      displayActiveTags,
      schedulesWithSubscription,
      tagIds,
      { page: safePage, totalPages, total },
    );
  }

  // 구독 태그 검색
  @View('schedule:modal:subscribe:search')
  async handleTagSearch({
    ack,
    body,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const selectedTags = values.tags_block?.tags_select?.selected_options ?? [];
    const tagIds = selectedTags.map((opt: { value: string }) =>
      parseInt(opt.value, 10),
    );

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) {
      await ack({
        response_action: 'errors',
        errors: { tags_block: '사용자 정보를 찾을 수 없습니다.' },
      });
      return;
    }

    const refreshToken = this.userService.getDecryptedRefreshToken(user);
    await ack({
      response_action: 'update',
      view: await this.buildSubscribeModal(0, tagIds, refreshToken ?? ''),
    });

    logger.info(
      `User ${user.name} searched schedules for tags: ${tagIds.join(', ') || '전체'}`,
    );
  }

  // 구독 페이지 이동 버튼
  @Action(/^schedule:subscribe:page:/)
  async handleSubscribePage({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { value: string };
    const page = parseInt(action.value, 10);
    const meta = JSON.parse(body.view?.private_metadata || '{}') as {
      selectedTagIds?: number[];
    };

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user || !body.view?.id) return;

    const refreshToken = this.userService.getDecryptedRefreshToken(user);
    await client.views.update({
      view_id: body.view.id,
      view: await this.buildSubscribeModal(
        page,
        meta.selectedTagIds ?? [],
        refreshToken ?? '',
      ),
    });
  }

  // 수정/관리 버튼 → 수정 모달 열기
  @Action(/^schedule:list:edit:/)
  async handleOpenEdit({
    ack,
    body,
    client,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);

    const [schedule, displayTags, permissions, notifChannelIds] =
      await Promise.all([
        this.scheduleService.findById(scheduleId),
        this.tagService.findDisplayTags(),
        this.scheduleService.getCalendarPermissions(scheduleId),
        this.channelService.getSlackChannelIds(scheduleId),
      ]);

    if (!schedule) return;

    const editorEmails = (permissions ?? [])
      .filter((p) => p.role === 'writer')
      .map((p) => p.email);
    const initialEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(editorEmails);

    await client.views.push({
      trigger_id: body.trigger_id,
      view: ScheduleView.editModal(
        {
          id: schedule.id,
          name: schedule.name,
          description: schedule.description,
          tags: schedule.tags,
        },
        displayTags,
        initialEditorSlackIds,
        notifChannelIds,
      ),
    });
  }

  // 수정 모달 제출 → 시간표 정보 업데이트
  @View('schedule:modal:edit')
  async handleEdit({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const name = values.name_block.name_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const selectedTags = values.tags_block?.tags_input?.selected_options ?? [];
    const scheduleId = parseInt(view.private_metadata, 10);

    if (!name.trim()) {
      await ack({
        response_action: 'errors',
        errors: { name_block: '과목명을 입력해주세요.' },
      });
      return;
    }

    await ack();

    const tagIds = selectedTags.map((opt: { value: string }) =>
      parseInt(opt.value, 10),
    );

    // 태그 교체 전에 기존 반 태그의 studentClassId 파악
    const beforeSchedule = await this.scheduleService.findById(scheduleId);
    const oldStudentClassIds = (beforeSchedule?.tags ?? [])
      .filter((t) => t.studentClassId)
      .map((t) => t.studentClassId!);

    const updated = await this.scheduleService.updateSchedule(scheduleId, {
      name: name.trim(),
      description: description?.trim(),
      tagIds,
    });

    // 알림 채널 저장: 제거된 반 채널 제외 후 교체, 신규 반 채널 동기화
    const selectedChannelIds =
      (
        values['notification_channels_block']?.['channels_select'] as
          | { selected_channels?: string[] }
          | undefined
      )?.selected_channels ?? [];

    const newStudentClassIds = (updated?.tags ?? [])
      .filter((t) => t.studentClassId)
      .map((t) => t.studentClassId!);
    const removedStudentClassIds = oldStudentClassIds.filter(
      (id) => !newStudentClassIds.includes(id),
    );
    const removedChannelIds = await this.channelService.getClassSlackChannelIds(
      removedStudentClassIds,
    );
    const filteredChannelIds = selectedChannelIds.filter(
      (id) => !removedChannelIds.includes(id),
    );

    await this.channelService.setScheduleChannels(
      scheduleId,
      filteredChannelIds,
    );
    await this.channelService.syncClassChannels(scheduleId, newStudentClassIds);

    // 수정자 diff 처리
    const selectedEditorIds =
      (
        values['editors_block']?.['editors_select'] as
          | { selected_users?: string[] }
          | undefined
      )?.selected_users ?? [];

    const currentPermissions =
      await this.scheduleService.getCalendarPermissions(scheduleId);
    const currentEditorEmails = (currentPermissions ?? [])
      .filter((p) => p.role === 'writer')
      .map((p) => p.email);
    const currentEditorSlackIds =
      await this.userService.mapEmailsToSlackIds(currentEditorEmails);

    const oldSet = new Set(currentEditorSlackIds);
    const newSet = new Set(selectedEditorIds);
    const toAdd = selectedEditorIds.filter((id) => !oldSet.has(id));
    const toRemove = currentEditorSlackIds.filter((id) => !newSet.has(id));

    await Promise.all([
      ...toAdd.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.scheduleService.shareCalendar(
            scheduleId,
            user.email,
            'writer',
          );
        }
      }),
      ...toRemove.map(async (slackId) => {
        const user = await this.userService.findBySlackId(slackId);
        if (user?.email) {
          await this.scheduleService.unshareCalendar(scheduleId, user.email);
        }
      }),
    ]);

    await client.chat.postMessage({
      channel: body.user.id,
      text: `시간표 "${name}"이(가) 수정되었습니다.`,
    });

    logger.info(`Schedule ${scheduleId} updated by ${body.user.id}`);
  }

  // 구독/구독해제 토글
  @Action(/^schedule:subscribe:toggle:/)
  async handleSubscribeToggle({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { action_id: string; value: string };
    const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
    const { action: toggleAction, tagIds } = JSON.parse(action.value) as {
      action: string;
      tagIds: number[];
    };

    // 사용자 정보 조회
    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) {
      logger.error('User not found for subscribe toggle');
      return;
    }

    // refresh token 확인 및 복호화
    const refreshToken = this.userService.getDecryptedRefreshToken(user);
    if (!refreshToken) {
      logger.error('User has no valid refresh token for subscribe toggle');
      await client.chat.postMessage({
        channel: body.user.id,
        text: '구독 기능을 사용하려면 Google 계정 재연동이 필요합니다. 회원정보를 다시 등록해주세요.',
      });
      return;
    }

    // 구독/구독해제 실행
    if (toggleAction === 'subscribe') {
      await this.scheduleService.subscribe(scheduleId, refreshToken);
      logger.info(`User ${user.name} subscribed to schedule ${scheduleId}`);
    } else {
      await this.scheduleService.unsubscribe(scheduleId, refreshToken);
      logger.info(`User ${user.name} unsubscribed from schedule ${scheduleId}`);
    }

    // 현재 페이지/태그 필터 유지하며 목록 새로고침
    const meta = JSON.parse(body.view?.private_metadata || '{}') as {
      selectedTagIds?: number[];
      page?: number;
    };

    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: await this.buildSubscribeModal(
          meta.page ?? 0,
          meta.selectedTagIds ?? tagIds,
          refreshToken,
        ),
      });
    }
  }

  // /반복일정생성 - 반복 일정 생성 모달
  @Command(CMD.반복일정생성)
  @Action('home:open-create-recurrence')
  async openCreateRecurringModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    const schedules = await this.scheduleService.findActiveSchedules();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.createRecurringModal(
        schedules.map((s) => ({ id: s.id, name: s.name })),
      ),
    });
  }

  // 반복 일정 생성 폼 제출
  @View('schedule:modal:create_recurring')
  async handleCreateRecurring({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;

    const scheduleId = parseInt(
      values.schedule_block.schedule_input.selected_option?.value ?? '',
      10,
    );
    const title = values.title_block.title_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const location = values.location_block?.location_input?.value ?? undefined;
    const startDate =
      values.start_date_block.start_date_input.selected_date ?? '';
    const endDate = values.end_date_block.end_date_input.selected_date ?? '';
    const startTime =
      values.start_time_block.start_time_input.selected_time ?? '';
    const endTime = values.end_time_block.end_time_input.selected_time ?? '';
    const recurrenceType = (values.recurrence_block.recurrence_input
      .selected_option?.value ?? 'weekly') as 'weekly' | 'biweekly' | 'monthly';
    const selectedDays =
      values.days_of_week_block?.days_of_week_input?.selected_options ?? [];
    const daysOfWeek = selectedDays.map((opt: { value: string }) =>
      parseInt(opt.value, 10),
    );

    // 유효성 검사
    if (!title.trim()) {
      await ack({
        response_action: 'errors',
        errors: { title_block: '이벤트 제목을 입력해주세요.' },
      });
      return;
    }
    if (!startDate || !endDate) {
      await ack({
        response_action: 'errors',
        errors: { start_date_block: '시작일과 종료일을 선택해주세요.' },
      });
      return;
    }
    if (endDate < startDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: '종료일은 시작일 이후여야 합니다.' },
      });
      return;
    }
    if (endTime <= startTime) {
      await ack({
        response_action: 'errors',
        errors: { end_time_block: '종료 시각은 시작 시각 이후여야 합니다.' },
      });
      return;
    }
    if (recurrenceType !== 'monthly' && daysOfWeek.length === 0) {
      await ack({
        response_action: 'errors',
        errors: {
          days_of_week_block: '매주/격주 반복 시 요일을 선택해주세요.',
        },
      });
      return;
    }

    await ack();

    await this.scheduleService.createRecurringEvents(
      {
        scheduleId,
        title: title.trim(),
        description: description?.trim(),
        location: location?.trim(),
        startDate,
        endDate,
        startTime,
        endTime,
        recurrenceType,
        daysOfWeek: recurrenceType !== 'monthly' ? daysOfWeek : undefined,
      },
      body.user.id,
    );

    await client.chat.postMessage({
      channel: body.user.id,
      text: `"${title}" 반복 일정 생성이 완료되었습니다.`,
    });
  }

  // /반복일정삭제 - 반복 일정 삭제 모달
  @Command(CMD.반복일정삭제)
  @Action('home:open-delete-recurrence')
  async openDeleteRecurringModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    const schedules =
      await this.scheduleService.findSchedulesWithRecurrenceGroups();

    if (schedules.length === 0) {
      if ('channel_id' in body) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: userId,
          text: '삭제할 반복 일정이 없습니다.',
        });
      }
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.selectScheduleForRecurringModal(schedules, 'delete'),
    });
  }

  // 반복 일정 삭제 - step1 (시간표 선택 후 반복 일정 목록 표시)
  @View('recurring:modal:step1:delete')
  async handleStep1DeleteRecurring({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const scheduleId = parseInt(
      values.schedule_block.schedule_input.selected_option?.value ?? '',
      10,
    );

    if (isNaN(scheduleId)) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '시간표를 선택해주세요.' },
      });
      return;
    }

    const [groups, schedules] = await Promise.all([
      this.scheduleService.findRecurrenceGroupsBySchedule(scheduleId),
      this.scheduleService.findActiveSchedules(),
    ]);
    const scheduleName = schedules.find((s) => s.id === scheduleId)?.name ?? '';

    if (groups.length === 0) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '해당 시간표에 반복 일정이 없습니다.' },
      });
      return;
    }

    await ack({
      response_action: 'push',
      view: ScheduleView.deleteRecurringModal(groups, scheduleName),
    });
  }

  // 반복 일정 삭제 폼 제출
  @View('recurring:modal:delete')
  async handleDeleteRecurring({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const groupDbId = parseInt(
      values.group_block.group_input.selected_option?.value ?? '',
      10,
    );
    const scope = (values.scope_block.scope_input.selected_option?.value ??
      'all') as 'all' | 'future';
    const filterOriginal =
      (values.filter_block.filter_input.selected_option?.value ??
        'original') === 'original';

    await ack();

    const { deleted, total } = await this.scheduleService.deleteRecurringGroup(
      groupDbId,
      scope,
      filterOriginal,
      body.user.id,
    );
    await client.chat.postMessage({
      channel: body.user.id,
      text: `반복 일정 삭제 완료: ${deleted}/${total}개`,
    });
  }

  // /반복일정수정 - 반복 일정 수정 모달
  @Command(CMD.반복일정수정)
  @Action('home:open-edit-recurrence')
  async openEditRecurringModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    const schedules =
      await this.scheduleService.findSchedulesWithRecurrenceGroups();

    if (schedules.length === 0) {
      if ('channel_id' in body) {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: userId,
          text: '수정할 반복 일정이 없습니다.',
        });
      }
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.selectScheduleForRecurringModal(schedules, 'edit'),
    });
  }

  // 반복 일정 수정 - step1 (시간표 선택 후 반복 일정 목록 표시)
  @View('recurring:modal:step1:edit')
  async handleStep1EditRecurring({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const scheduleId = parseInt(
      values.schedule_block.schedule_input.selected_option?.value ?? '',
      10,
    );

    if (isNaN(scheduleId)) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '시간표를 선택해주세요.' },
      });
      return;
    }

    const [groups, schedules] = await Promise.all([
      this.scheduleService.findRecurrenceGroupsBySchedule(scheduleId),
      this.scheduleService.findActiveSchedules(),
    ]);
    const scheduleName = schedules.find((s) => s.id === scheduleId)?.name ?? '';

    if (groups.length === 0) {
      await ack({
        response_action: 'errors',
        errors: { schedule_block: '해당 시간표에 반복 일정이 없습니다.' },
      });
      return;
    }

    await ack({
      response_action: 'push',
      view: ScheduleView.selectGroupForEditModal(
        groups,
        scheduleName,
        scheduleId,
      ),
    });
  }

  // 반복 일정 수정 - step2 (그룹 선택 후 프리필 폼 표시)
  @View('recurring:modal:step2:edit')
  async handleStep2EditRecurring({
    ack,
    view,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { scheduleName } = JSON.parse(view.private_metadata || '{}') as {
      scheduleName: string;
    };
    const groupDbId = parseInt(
      view.state.values.group_block.group_input.selected_option?.value ?? '',
      10,
    );

    if (isNaN(groupDbId)) {
      await ack({
        response_action: 'errors',
        errors: { group_block: '반복 일정을 선택해주세요.' },
      });
      return;
    }

    const group = await this.scheduleService.findRecurrenceGroupById(groupDbId);
    if (!group) {
      await ack({
        response_action: 'errors',
        errors: { group_block: '반복 일정을 찾을 수 없습니다.' },
      });
      return;
    }

    await ack({
      response_action: 'push',
      view: ScheduleView.editRecurringModal(group, scheduleName),
    });
  }

  // 반복 일정 수정 폼 제출
  @View('recurring:modal:edit')
  async handleEditRecurring({
    ack,
    body,
    view,
    client,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { groupDbId } = JSON.parse(view.private_metadata || '{}') as {
      groupDbId: number;
    };
    const values = view.state.values;
    const title = values.title_block.title_input.value ?? undefined;
    const description =
      values.description_block.description_input.value ?? undefined;
    const location = values.location_block.location_input.value ?? undefined;
    const startTime =
      values.start_time_block.start_time_input.selected_time ?? undefined;
    const endTime =
      values.end_time_block.end_time_input.selected_time ?? undefined;
    const scope = (values.scope_block.scope_input.selected_option?.value ??
      'all') as 'all' | 'future';
    const rawDays =
      values.days_of_week_block?.days_of_week_input?.selected_options;
    const daysOfWeek =
      rawDays && rawDays.length > 0
        ? rawDays.map((o) => parseInt(o.value, 10))
        : undefined;
    const startDate =
      values.start_date_block?.start_date_input?.selected_date ?? undefined;
    const endDate =
      values.end_date_block?.end_date_input?.selected_date ?? undefined;

    if (startDate && endDate && startDate > endDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: '종료일이 시작일보다 앞입니다.' },
      });
      return;
    }

    if (startTime && !endTime) {
      await ack({
        response_action: 'errors',
        errors: { end_time_block: '종료 시각도 함께 입력해주세요.' },
      });
      return;
    }
    if (!startTime && endTime) {
      await ack({
        response_action: 'errors',
        errors: { start_time_block: '시작 시각도 함께 입력해주세요.' },
      });
      return;
    }

    await ack();

    const { updated, total } = await this.scheduleService.updateRecurringGroup(
      groupDbId,
      {
        title,
        description,
        location,
        startTime,
        endTime,
        daysOfWeek,
        startDate,
        endDate,
      },
      scope,
      body.user.id,
    );
    await client.chat.postMessage({
      channel: body.user.id,
      text: `반복 일정 수정 완료: ${updated}/${total}개`,
    });
  }

  // 태그 시간표 — 태그별 구글 캘린더 링크 모달 열기
  @Action('home:open-tag-schedule')
  async openTagScheduleList({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const userId = body.user.id;
    const { isActive, message } = await this.checkActiveUser(userId);
    if (!isActive) {
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: message!,
      });
      return;
    }

    const displayTags = await this.tagService.findDisplayTags(true);

    // 태그별 활성 시간표 병렬 조회 → 구글 캘린더 통합 URL 생성
    const tagItems = (
      await Promise.all(
        displayTags.map(async (tag) => {
          const schedules =
            await this.scheduleService.findActiveSchedulesByTagId(tag.id);
          if (schedules.length === 0) return null;

          const calendarUrl =
            'https://calendar.google.com/calendar/embed?' +
            schedules
              .map(
                (s, i) =>
                  `src=${encodeURIComponent(s.calendarId)}&color=${CALENDAR_COLORS[i % CALENDAR_COLORS.length]}`,
              )
              .join('&') +
            '&ctz=Asia%2FSeoul&mode=WEEK';

          return { id: tag.id, name: tag.name, calendarUrl };
        }),
      )
    ).filter((item) => item !== null);

    // 태그 없는 시간표도 통합해서 추가
    const untaggedSchedules =
      await this.scheduleService.findActiveSchedulesWithoutTags();
    if (untaggedSchedules.length > 0) {
      const calendarUrl =
        'https://calendar.google.com/calendar/embed?' +
        untaggedSchedules
          .map(
            (s, i) =>
              `src=${encodeURIComponent(s.calendarId)}&color=${CALENDAR_COLORS[i % CALENDAR_COLORS.length]}`,
          )
          .join('&') +
        '&ctz=Asia%2FSeoul&mode=WEEK';
      tagItems.push({ id: -1, name: '태그 없음', calendarUrl });
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: TagView.tagScheduleListModal(tagItems),
    });
  }

  // 알림 메시지의 구글 캘린더 URL 버튼 ack
  @Action('notification:open-calendar')
  async ackNotificationCalendarLink({
    ack,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
  }
}
