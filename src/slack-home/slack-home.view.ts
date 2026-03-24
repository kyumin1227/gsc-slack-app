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
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📋 내 예약*\n참석자로 등록된 스터디룸 일정을 확인하고 수정·취소할 수 있어요.',
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '내 예약 보기' },
            style: 'primary',
            action_id: 'home:open-my-bookings',
          },
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
