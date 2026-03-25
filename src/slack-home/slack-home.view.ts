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
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📅 시간표 구독*\n시간표를 구독하면 Google Calendar에서 수업 일정을 받아볼 수 있어요.',
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '구독하기' },
            style: 'primary',
            action_id: 'home:open-subscribe',
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📚 스터디룸 예약*\n스터디룸의 일정을 확인하고 예약할 수 있어요.',
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '예약하기' },
            style: 'primary',
            action_id: 'home:open-booking',
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📋 내 예약*\n참석자로 등록된 스터디룸 일정을 확인하고 수정·취소할 수 있어요.',
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '예약보기' },
            style: 'primary',
            action_id: 'home:open-my-bookings',
          },
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
              url: 'https://github.com/kyumin1227/gsc-slack-app/issues/new?labels=bug',
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
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📅 시간표*\n시간표를 구독하거나 생성·수정할 수 있어요.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '구독' },
              style: 'primary',
              action_id: 'home:open-subscribe',
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
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🔄 반복일정 관리*\n반복 수업 일정을 생성하거나 수정·삭제할 수 있어요.',
          },
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
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*✅ 회원 승인*\n가입 신청한 회원을 승인하거나 거절할 수 있어요.',
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '승인하기' },
            action_id: 'home:open-approval',
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🏷️ 태그 관리*\n시간표 분류에 사용할 태그를 조회하고 생성할 수 있어요.',
          },
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
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🏠 스터디룸*\n스터디룸을 예약하거나 생성·수정할 수 있어요.',
          },
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
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📋 내 예약*\n참석자로 등록된 스터디룸 일정을 확인하고 수정·취소할 수 있어요.',
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '내 예약 보기' },
            action_id: 'home:open-my-bookings',
          },
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
              url: 'https://github.com/kyumin1227/gsc-slack-app/issues/new?labels=bug',
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
