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
import { ScheduleView, WriterItem } from './schedule.view';
import { UserService } from '../user/user.service';
import { TagService } from '../tag/tag.service';
import { ChannelService } from '../channel/channel.service';
import { UserRole, UserStatus, User } from '../user/user.entity';
import { CMD } from '../common/slack-commands';

@Controller()
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly userService: UserService,
    private readonly tagService: TagService,
    private readonly channelService: ChannelService,
  ) {}

  // 조교 이상 권한 확인 헬퍼
  private async checkAdminPermission(
    slackUserId: string,
  ): Promise<{ hasPermission: boolean; user?: User; message?: string }> {
    const user = await this.userService.findBySlackId(slackUserId);
    const allowedRoles = [UserRole.PROFESSOR, UserRole.TA];

    if (!user || !allowedRoles.includes(user.role)) {
      return {
        hasPermission: false,
        message: '이 명령어는 조교 이상 권한이 필요합니다.',
      };
    }
    return { hasPermission: true, user };
  }

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

    return ScheduleView.listModal(
      schedules.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status,
        tags: s.tags.map((t) => ({
          id: t.id,
          name: displayTagMap.get(t.id) ?? t.name,
        })),
        createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
        createdAt: s.createdAt,
      })),
      displayTags,
      {
        page: safePage,
        totalPages,
        total,
        selectedStatus: status,
        selectedTagIds: tagIds,
      },
    );
  }

  // /시간표 - 시간표 목록 조회
  @Command(CMD.시간표)
  async listSchedules({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkAdminPermission(
      body.user_id,
    );
    if (!hasPermission) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: await this.buildListModal(0, 'all', []),
    });
  }

  // /시간표생성 - 시간표 생성 모달
  @Command(CMD.시간표생성)
  async openCreateModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkAdminPermission(
      body.user_id,
    );
    if (!hasPermission) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
      return;
    }

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

    try {
      const tagIds = selectedTags.map((opt: { value: string }) =>
        parseInt(opt.value, 10),
      );

      const creatorRefreshToken =
        this.userService.getDecryptedRefreshToken(user);

      await this.scheduleService.createSchedule({
        name: name.trim(),
        description: description?.trim(),
        tagIds,
        createdById: user.id,
        creatorEmail: user.email,
        creatorRefreshToken: creatorRefreshToken ?? undefined,
      });

      await client.chat.postMessage({
        channel: body.user.id,
        text: `시간표 "${name}"이(가) 생성되었습니다. Google Calendar가 함께 생성되었습니다.`,
      });

      logger.info(`Schedule created: ${name} by ${user.name}`);
    } catch (error) {
      logger.error('Create schedule error:', error);

      const err = error as { message?: string };
      await client.chat.postMessage({
        channel: body.user.id,
        text: `시간표 생성 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
      });
    }
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

    try {
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
    } catch (error) {
      logger.error('Toggle schedule error:', error);
    }
  }

  // 조회 버튼(submit) → 필터 적용, 모달 유지
  @View('schedule:modal:list')
  async handleSearch({
    ack,
    view,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    try {
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
    } catch (error) {
      logger.error('Search schedule error:', error);
      await ack();
    }
  }

  // 페이지 이동 버튼
  @Action(/^schedule:list:page:/)
  async handlePageChange({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
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
    } catch (error) {
      logger.error('Page change error:', error);
    }
  }

  // /구독 - 시간표 구독 (태그 선택)
  @Command(CMD.구독)
  async openSubscribeModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { isActive, message } = await this.checkActiveUser(body.user_id);
    if (!isActive) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
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
    userEmail: string,
  ) {
    const tagFilter = tagIds.length > 0 ? tagIds : undefined;

    const [{ schedules, total }, displayActiveTags] = await Promise.all([
      this.scheduleService.findSchedulesPaginated({
        page,
        pageSize: this.SCHEDULE_PAGE_SIZE,
        status: 'active',
        tagIds: tagFilter,
      }),
      this.tagService.findDisplayTags(true),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / this.SCHEDULE_PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const displayActiveTagMap = new Map(displayActiveTags.map((t) => [t.id, t.name]));

    const schedulesWithSubscription = await Promise.all(
      schedules.map(async (s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags.map((t) => ({
          id: t.id,
          name: displayActiveTagMap.get(t.id) ?? t.name,
        })),
        createdBy: { name: s.createdBy?.name ?? '알 수 없음' },
        createdAt: s.createdAt,
        isSubscribed: await this.scheduleService.isSubscribed(s.id, userEmail),
      })),
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
    try {
      const values = view.state.values;
      const selectedTags =
        values.tags_block?.tags_select?.selected_options ?? [];
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

      await ack({
        response_action: 'update',
        view: await this.buildSubscribeModal(0, tagIds, user.email),
      });

      logger.info(
        `User ${user.name} searched schedules for tags: ${tagIds.join(', ') || '전체'}`,
      );
    } catch (error) {
      logger.error('Tag search error:', error);
      await ack({
        response_action: 'errors',
        errors: { tags_block: '검색 중 오류가 발생했습니다.' },
      });
    }
  }

  // 구독 페이지 이동 버튼
  @Action(/^schedule:subscribe:page:/)
  async handleSubscribePage({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
      const action = body.actions[0] as { value: string };
      const page = parseInt(action.value, 10);
      const meta = JSON.parse(body.view?.private_metadata || '{}') as {
        selectedTagIds?: number[];
      };

      const user = await this.userService.findBySlackId(body.user.id);
      if (!user || !body.view?.id) return;

      await client.views.update({
        view_id: body.view.id,
        view: await this.buildSubscribeModal(
          page,
          meta.selectedTagIds ?? [],
          user.email,
        ),
      });
    } catch (error) {
      logger.error('Subscribe page change error:', error);
    }
  }

  // 수정/관리 버튼 → 수정 모달 열기
  @Action(/^schedule:list:edit:/)
  async handleOpenEdit({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
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

      // 편집자 목록에 슬랙 이름 보강
      const writers: WriterItem[] = await Promise.all(
        (permissions ?? []).map(async (p) => {
          const user = await this.userService.findByEmail(p.email);
          return { email: p.email, role: p.role, name: user?.name };
        }),
      );

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
          writers,
          notifChannelIds,
        ),
      });
    } catch (error) {
      logger.error('Open edit modal error:', error);
    }
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

    try {
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
      const removedChannelIds =
        await this.channelService.getClassSlackChannelIds(
          removedStudentClassIds,
        );
      const filteredChannelIds = selectedChannelIds.filter(
        (id) => !removedChannelIds.includes(id),
      );

      await this.channelService.setScheduleChannels(
        scheduleId,
        filteredChannelIds,
      );
      await this.channelService.syncClassChannels(
        scheduleId,
        newStudentClassIds,
      );

      await client.chat.postMessage({
        channel: body.user.id,
        text: `시간표 "${name}"이(가) 수정되었습니다.`,
      });

      logger.info(`Schedule ${scheduleId} updated by ${body.user.id}`);
    } catch (error) {
      logger.error('Update schedule error:', error);
      const err = error as { message?: string };
      await client.chat.postMessage({
        channel: body.user.id,
        text: `시간표 수정 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
      });
    }
  }

  // 편집자 제거 버튼
  @Action(/^schedule:manage:writer:remove:/)
  async handleRemoveWriter({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
      const action = body.actions[0] as { action_id: string; value: string };
      const scheduleId = parseInt(action.action_id.split(':').pop()!, 10);
      const email = action.value;

      await this.scheduleService.unshareCalendar(scheduleId, email);

      // 현재 입력값 보존 후 모달 갱신
      const currentValues =
        (
          body as BlockAction & {
            view?: {
              state?: {
                values?: Record<
                  string,
                  Record<
                    string,
                    {
                      value?: string;
                      selected_options?: {
                        value: string;
                        text: { text: string };
                      }[];
                    }
                  >
                >;
              };
            };
          }
        ).view?.state?.values ?? {};
      const currentName = currentValues['name_block']?.['name_input']?.value;
      const currentDescription =
        currentValues['description_block']?.['description_input']?.value;
      const currentTagOptions =
        currentValues['tags_block']?.['tags_input']?.selected_options;

      const [schedule, displayTags, permissions, notifChannelIds] =
        await Promise.all([
          this.scheduleService.findById(scheduleId),
          this.tagService.findDisplayTags(),
          this.scheduleService.getCalendarPermissions(scheduleId),
          this.channelService.getSlackChannelIds(scheduleId),
        ]);

      if (!body.view?.id || !schedule) return;

      const writers: WriterItem[] = await Promise.all(
        (permissions ?? []).map(async (p) => {
          const user = await this.userService.findByEmail(p.email);
          return { email: p.email, role: p.role, name: user?.name };
        }),
      );

      await client.views.update({
        view_id: body.view.id,
        view: ScheduleView.editModal(
          {
            id: schedule.id,
            name: currentName ?? schedule.name,
            description: currentDescription ?? schedule.description,
            tags: currentTagOptions
              ? currentTagOptions.map((opt) => ({
                  id: parseInt(opt.value, 10),
                  name: opt.text.text,
                }))
              : schedule.tags,
          },
          displayTags,
          writers,
          notifChannelIds,
        ),
      });

      logger.info(`Writer ${email} removed from schedule ${scheduleId}`);
    } catch (error) {
      logger.error('Remove writer error:', error);
    }
  }

  // 편집자 추가 모달 열기
  @Action('schedule:manage:writer:open:add')
  async handleOpenAddWriter({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
      const action = body.actions[0] as { value: string };
      const scheduleId = parseInt(action.value, 10);
      const editViewId = body.view?.id ?? '';

      await client.views.push({
        trigger_id: body.trigger_id,
        view: ScheduleView.addWriterModal(scheduleId, editViewId),
      });
    } catch (error) {
      logger.error('Open add writer modal error:', error);
    }
  }

  // 편집자 추가 모달 제출
  @View('schedule:modal:add:writer')
  async handleAddWriter({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { scheduleId, editViewId } = JSON.parse(view.private_metadata) as {
      scheduleId: number;
      editViewId: string;
    };

    const selectedUserId =
      view.state.values.user_block?.user_input?.selected_user;

    if (!selectedUserId) {
      await ack({
        response_action: 'errors',
        errors: { user_block: '편집자를 선택해주세요.' },
      });
      return;
    }

    // 슬랙 user ID → 이메일 조회 (DB 우선, fallback: Slack API)
    let email: string | undefined;
    let displayName: string | undefined;

    const dbUser = await this.userService.findBySlackId(selectedUserId);
    if (dbUser) {
      email = dbUser.email;
      displayName = dbUser.name;
    } else {
      const result = await client.users.info({ user: selectedUserId });
      email = result.user?.profile?.email ?? undefined;
      displayName =
        result.user?.profile?.display_name ??
        result.user?.real_name ??
        undefined;
    }

    if (!email) {
      await ack({
        response_action: 'errors',
        errors: {
          user_block:
            '해당 사용자의 이메일을 가져올 수 없습니다. 먼저 회원가입을 완료해주세요.',
        },
      });
      return;
    }

    await ack();

    try {
      await this.scheduleService.shareCalendar(scheduleId, email, 'writer');

      // 편집자 추가 후 수정 모달 갱신
      const [schedule, displayTags, permissions] = await Promise.all([
        this.scheduleService.findById(scheduleId),
        this.tagService.findDisplayTags(),
        this.scheduleService.getCalendarPermissions(scheduleId),
      ]);

      if (editViewId && schedule) {
        const writers: WriterItem[] = await Promise.all(
          (permissions ?? []).map(async (p) => {
            const user = await this.userService.findByEmail(p.email);
            return { email: p.email, role: p.role, name: user?.name };
          }),
        );

        await client.views.update({
          view_id: editViewId,
          view: ScheduleView.editModal(
            {
              id: schedule.id,
              name: schedule.name,
              description: schedule.description,
              tags: schedule.tags,
            },
            displayTags,
            writers,
          ),
        });
      }

      logger.info(
        `Writer ${displayName ?? email} added to schedule ${scheduleId}`,
      );
    } catch (error) {
      logger.error('Add writer error:', error);
      const err = error as { message?: string };
      await client.chat.postMessage({
        channel: body.user.id,
        text: `편집자 추가 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
      });
    }
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

    try {
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
        await this.scheduleService.subscribe(
          scheduleId,
          user.email,
          refreshToken,
        );
        logger.info(`User ${user.name} subscribed to schedule ${scheduleId}`);
      } else {
        await this.scheduleService.unsubscribe(
          scheduleId,
          user.email,
          refreshToken,
        );
        logger.info(
          `User ${user.name} unsubscribed from schedule ${scheduleId}`,
        );
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
            user.email,
          ),
        });
      }
    } catch (error) {
      logger.error('Subscribe toggle error:', error);
    }
  }

  // /반복일정생성 - 반복 일정 생성 모달
  @Command(CMD.반복일정생성)
  async openCreateRecurringModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkAdminPermission(
      body.user_id,
    );
    if (!hasPermission) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
      return;
    }

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
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;

    const scheduleId = parseInt(
      values.schedule_block.schedule_input.selected_option?.value ?? '',
      10,
    );
    const title = values.title_block.title_input.value ?? '';
    const description =
      values.description_block?.description_input?.value ?? undefined;
    const location =
      values.location_block?.location_input?.value ?? undefined;
    const startDate =
      values.start_date_block.start_date_input.selected_date ?? '';
    const endDate =
      values.end_date_block.end_date_input.selected_date ?? '';
    const startTime =
      values.start_time_block.start_time_input.selected_time ?? '';
    const endTime =
      values.end_time_block.end_time_input.selected_time ?? '';
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
        errors: { days_of_week_block: '매주/격주 반복 시 요일을 선택해주세요.' },
      });
      return;
    }

    await ack();

    try {
      await this.scheduleService.createRecurringEvents({
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
      });

      await client.chat.postMessage({
        channel: body.user.id,
        text: `"${title}" 반복 일정 생성이 완료되었습니다.`,
      });
    } catch (error) {
      logger.error('Create recurring events error:', error);
      const err = error as { message?: string };
      await client.chat.postMessage({
        channel: body.user.id,
        text: `반복 일정 생성 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
      });
    }
  }

  // /반복일정삭제 - 반복 일정 삭제 모달
  @Command(CMD.반복일정삭제)
  async openDeleteRecurringModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkAdminPermission(
      body.user_id,
    );
    if (!hasPermission) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
      return;
    }

    const groups = await this.scheduleService.findAllRecurrenceGroups();

    if (groups.length === 0) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: '삭제할 반복 일정이 없습니다.',
      });
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.deleteRecurringModal(groups),
    });
  }

  // 반복 일정 삭제 폼 제출
  @View('recurring:modal:delete')
  async handleDeleteRecurring({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const groupDbId = parseInt(
      values.group_block.group_input.selected_option?.value ?? '',
      10,
    );
    const scope = (values.scope_block.scope_input.selected_option?.value ??
      'all') as 'all' | 'future';

    await ack();

    try {
      const { deleted, total } =
        await this.scheduleService.deleteRecurringGroup(groupDbId, scope);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `반복 일정 삭제 완료: ${deleted}/${total}개`,
      });
    } catch (error) {
      logger.error('Delete recurring events error:', error);
      const err = error as { message?: string };
      await client.chat.postMessage({
        channel: body.user.id,
        text: `반복 일정 삭제 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
      });
    }
  }

  // /반복일정수정 - 반복 일정 수정 모달
  @Command(CMD.반복일정수정)
  async openEditRecurringModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const { hasPermission, message } = await this.checkAdminPermission(
      body.user_id,
    );
    if (!hasPermission) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: message!,
      });
      return;
    }

    const groups = await this.scheduleService.findAllRecurrenceGroups();

    if (groups.length === 0) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: '수정할 반복 일정이 없습니다.',
      });
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.editRecurringModal(groups),
    });
  }

  // 반복 일정 수정 폼 제출
  @View('recurring:modal:edit')
  async handleEditRecurring({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const groupDbId = parseInt(
      values.group_block.group_input.selected_option?.value ?? '',
      10,
    );
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

    try {
      const { updated, total } =
        await this.scheduleService.updateRecurringGroup(
          groupDbId,
          { title, description, location, startTime, endTime },
          scope,
        );
      await client.chat.postMessage({
        channel: body.user.id,
        text: `반복 일정 수정 완료: ${updated}/${total}개`,
      });
    } catch (error) {
      logger.error('Edit recurring events error:', error);
      const err = error as { message?: string };
      await client.chat.postMessage({
        channel: body.user.id,
        text: `반복 일정 수정 중 오류가 발생했습니다: ${err.message ?? '알 수 없는 오류'}`,
      });
    }
  }
}
