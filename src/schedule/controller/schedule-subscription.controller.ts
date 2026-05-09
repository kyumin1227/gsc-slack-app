import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { ScheduleService } from '../service/schedule.service';
import { ScheduleView } from '../view/schedule.view';
import { UserService } from '../../user/user.service';
import { TagService } from '../../tag/tag.service';
import { TagView } from '../../tag/tag.view';
import { ChannelService } from '../../channel/channel.service';
import { UserStatus, User } from '../../user/user.entity';
import { GoogleCalendarService } from '../../google/google-calendar.service';
import { CALENDAR_COLORS } from '../../common/constants';
import { SCHEDULE_PAGE_SIZE } from '../constants';

@Controller()
export class ScheduleSubscriptionController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly userService: UserService,
    private readonly tagService: TagService,
    private readonly channelService: ChannelService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

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

  private async buildSubscribeModal(
    page: number,
    tagIds: number[],
    userRefreshToken: string,
  ) {
    const tagFilter = tagIds.length > 0 ? tagIds : undefined;

    const [{ schedules: rawSchedules, total }, displayActiveTags, subscribedIds] =
      await Promise.all([
        this.scheduleService.findSchedulesPaginated({
          page,
          pageSize: SCHEDULE_PAGE_SIZE,
          status: 'active',
          tagIds: tagFilter,
        }),
        this.tagService.findDisplayTags(true),
        this.scheduleService.getSubscribedCalendarIds(userRefreshToken),
      ]);

    const totalPages = Math.max(1, Math.ceil(total / SCHEDULE_PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const schedules =
      safePage !== page
        ? (
            await this.scheduleService.findSchedulesPaginated({
              page: safePage,
              pageSize: SCHEDULE_PAGE_SIZE,
              status: 'active',
              tagIds: tagFilter,
            })
          ).schedules
        : rawSchedules;
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

  // 구독 모달 열기
  @Action('home:open-subscribe')
  async openSubscribeModal({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();
    const { isActive } = await this.checkActiveUser(body.user.id);
    if (!isActive) return;
    const tags = await this.tagService.findDisplayTags();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ScheduleView.subscribeSearchModal(tags),
    });
  }

  // 태그 필터 제출 → 구독 목록 갱신
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

  // 구독 목록 페이지 이동
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

  // 구독/구독 해제 토글
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

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) {
      logger.error('User not found for subscribe toggle');
      return;
    }

    const refreshToken = this.userService.getDecryptedRefreshToken(user);
    if (!refreshToken) {
      logger.error('User has no valid refresh token for subscribe toggle');
      await client.chat.postMessage({
        channel: body.user.id,
        text: '구독 기능을 사용하려면 Google 계정 재연동이 필요합니다. 회원정보를 다시 등록해주세요.',
      });
      return;
    }

    if (toggleAction === 'subscribe') {
      await this.scheduleService.subscribe(scheduleId, refreshToken);
      logger.info(`User ${user.name} subscribed to schedule ${scheduleId}`);
    } else {
      await this.scheduleService.unsubscribe(scheduleId, refreshToken);
      logger.info(`User ${user.name} unsubscribed from schedule ${scheduleId}`);
    }

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

  // 태그별 구글 캘린더 링크 모달 열기
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
      await client.chat.postMessage({
        channel: userId,
        text: message!,
      });
      return;
    }

    const displayTags = await this.tagService.findDisplayTags(true);

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
