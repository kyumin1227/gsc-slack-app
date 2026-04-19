import type { View } from '@slack/types';
import type { User } from '../user/user.entity';

export class HomeView {
  static registration(): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*회원 가입이 필요합니다* 🔐',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '가입하기',
                emoji: true,
              },
              style: 'primary',
              action_id: 'user:home:open_register_modal',
            },
          ],
        },
      ],
    };
  }

  static registered(): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*가입 되었습니다* ✅',
          },
        },
      ],
    };
  }

  static pendingApproval(): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*승인 대기 중입니다* ⏳\n관리자 승인 후 서비스를 이용할 수 있어요.',
          },
        },
      ],
    };
  }

  static activeStudent(user: User): View {
    const className = user.studentClass?.name ?? '';
    const infoLine = [user.code, user.email, className]
      .filter(Boolean)
      .join('  |  ');

    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*안녕하세요, ${user.name}님!* 👋\n\n아래 기능을 이용할 수 있어요.`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ 내 정보 수정' },
            action_id: 'home:open-my-info',
          },
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '📅 시간표', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '수업 일정을 *Google Calendar* 에서 받아보거나, 교실별/태그별 일정을 모아볼 수 있어요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '과목 시간표' },
              style: 'primary',
              action_id: 'home:open-subscribe',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '교실 시간표' },
              action_id: 'home:open-classroom-schedule',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '태그 시간표' },
              action_id: 'home:open-tag-schedule',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '📚 스터디룸', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '스터디룸 일정을 확인하고 *예약* 할 수 있어요. 내 예약을 확인하고 *수정·취소* 도 가능해요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '예약하기' },
              style: 'primary',
              action_id: 'home:open-booking',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '예약 수정' },
              action_id: 'home:open-my-bookings',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '🗓️ 캘린더' },
              action_id: 'home:google-calendar',
              url: 'https://calendar.google.com',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '🔗 외부 캘린더 연동' },
              action_id: 'home:external-calendar',
              url: 'https://www.google.com/calendar/syncselect',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '📖 사용 가이드' },
              action_id: 'home:user-guide',
              url: 'https://www.kyumin.dev/ko/posts/bannote-slack/user-guide',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '🐛 버그 제보' },
              action_id: 'home:report-bug',
              url: 'https://github.com/kyumin1227/gsc-slack-app/issues/new?template=bug_report.yml',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '✨ 기능 제안' },
              action_id: 'home:request-feature',
              url: 'https://github.com/kyumin1227/gsc-slack-app/issues/new?template=feature_request.yml',
            },
          ],
        },
      ],
    };
  }

  static activeStaff(user: User): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*안녕하세요, ${user.name}님!* 👋\n\n아래 기능을 이용할 수 있어요.`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ 내 정보 수정' },
            action_id: 'home:open-my-info',
          },
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '📅 시간표', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '시간표를 *구독* 하거나 *생성·수정* 할 수 있어요. 교실별/태그별 일정도 모아볼 수 있어요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '과목 시간표' },
              style: 'primary',
              action_id: 'home:open-subscribe',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '교실 시간표' },
              action_id: 'home:open-classroom-schedule',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '태그 시간표' },
              action_id: 'home:open-tag-schedule',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '생성' },
              style: 'primary',
              action_id: 'home:open-create-schedule',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '수정' },
              action_id: 'home:open-schedule-list',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '🔄 반복일정 관리', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '반복 수업 일정을 *생성* 하거나 *수정·삭제* 할 수 있어요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '생성' },
              style: 'primary',
              action_id: 'home:open-create-recurrence',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '수정' },
              action_id: 'home:open-edit-recurrence',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '삭제' },
              style: 'danger',
              action_id: 'home:open-delete-recurrence',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '👥 유저 관리', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '전체 유저 목록을 조회하고 정보를 *수정* 하거나, 가입 신청을 *승인·거절* 할 수 있어요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '유저 관리' },
              action_id: 'home:open-user-management',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '가입 승인' },
              action_id: 'home:open-approval',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '🏫 반 관리', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '반을 *생성* 하거나 목록을 *조회·관리* 할 수 있어요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '반 생성' },
              style: 'primary',
              action_id: 'home:open-class-create',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '반 목록' },
              action_id: 'home:open-class-list',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '🏷️ 태그 관리', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '시간표 분류에 사용할 태그를 *조회* 하고 *생성* 할 수 있어요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '태그 생성' },
              style: 'primary',
              action_id: 'home:open-create-tag',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '태그 목록' },
              action_id: 'home:open-tags',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'header',
          text: { type: 'plain_text', text: '🏠 스터디룸', emoji: true },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '스터디룸을 *예약* 하거나 *생성·수정* 할 수 있어요. 내 예약을 확인하고 *수정·취소* 도 가능해요.',
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '예약하기' },
              style: 'primary',
              action_id: 'home:open-booking',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '예약 수정' },
              action_id: 'home:open-my-bookings',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '생성' },
              style: 'primary',
              action_id: 'home:open-create-study-room',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '수정' },
              action_id: 'home:open-study-room-manage',
            },
          ],
        },
        { type: 'divider' },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '🗓️ 캘린더' },
              action_id: 'home:google-calendar',
              url: 'https://calendar.google.com',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '🔗 외부 캘린더 연동' },
              action_id: 'home:external-calendar',
              url: 'https://www.google.com/calendar/syncselect',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '📖 사용 가이드' },
              action_id: 'home:user-guide',
              url: 'https://www.kyumin.dev/ko/posts/bannote-slack/user-guide',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '🐛 버그 제보' },
              action_id: 'home:report-bug',
              url: 'https://github.com/kyumin1227/gsc-slack-app/issues/new?template=bug_report.yml',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '✨ 기능 제안' },
              action_id: 'home:request-feature',
              url: 'https://github.com/kyumin1227/gsc-slack-app/issues/new?template=feature_request.yml',
            },
          ],
        },
      ],
    };
  }

  static inactive(): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*비활성화된 계정입니다* ❌\n관리자에게 문의해주세요.',
          },
        },
      ],
    };
  }

  static error(): View {
    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*오류가 발생했습니다* ❌\n잠시 후 다시 시도해주세요.',
          },
        },
      ],
    };
  }
}
