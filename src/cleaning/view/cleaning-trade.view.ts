import type { View, KnownBlock } from '@slack/types';
import { DAY_LABELS, ruleInfoText } from './cleaning-rule.view';
import { AssignmentDetail } from '../service/cleaning-trade.service';
import { RuleWithDetails } from '../service/cleaning-rule.service';

export class CleaningTradeView {
  // 일반 사용자가 자신의 예정 배정을 확인하고 교환 요청으로 진입하는 모달.
  static myAssignmentsModal(assignments: AssignmentDetail[]): View {
    const blocks: View['blocks'] = [];

    if (assignments.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '배정된 청소 일정이 없습니다.' },
      });
    } else {
      for (const a of assignments) {
        const [year, month, day] = a.cleaningDate.split('-').map(Number);
        const dayOfWeek = DAY_LABELS[new Date(year, month - 1, day).getDay()];
        const coText =
          a.coAssignees && a.coAssignees.length > 0
            ? `\n함께하는 인원: ${a.coAssignees.join(', ')}`
            : '';
        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${a.cleaningDate} (${dayOfWeek})* | ${a.resourceName}${coText}`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '교환 요청' },
              action_id: 'cleaning:trade:open',
              value: String(a.id),
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:my-assignments',
      title: { type: 'plain_text', text: '내 청소 배정' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static myPendingRequestsModal(
    requests: {
      trade: { id: number };
      myAssignment: AssignmentDetail;
      targetAssignment: AssignmentDetail;
    }[],
  ): View {
    const blocks: View['blocks'] = [];

    if (requests.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '대기 중인 교환 요청이 없습니다.' },
      });
    } else {
      for (const { trade, myAssignment, targetAssignment } of requests) {
        const [myY, myM, myD] = myAssignment.cleaningDate
          .split('-')
          .map(Number);
        const [tgtY, tgtM, tgtD] = targetAssignment.cleaningDate
          .split('-')
          .map(Number);
        const myDay = DAY_LABELS[new Date(myY, myM - 1, myD).getDay()];
        const tgtDay = DAY_LABELS[new Date(tgtY, tgtM - 1, tgtD).getDay()];

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: [
                `*내 배정:* ${myAssignment.cleaningDate} (${myDay}) — ${myAssignment.resourceName}`,
                `*상대방:* ${targetAssignment.userName}${targetAssignment.userCode ? ` (${targetAssignment.userCode})` : ''} | ${targetAssignment.cleaningDate} (${tgtDay})`,
              ].join('\n'),
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '취소' },
              action_id: 'cleaning:trade:cancel',
              value: String(trade.id),
              style: 'danger',
              confirm: {
                title: { type: 'plain_text', text: '요청 취소' },
                text: {
                  type: 'mrkdwn',
                  text: '이 교환 요청을 취소하시겠습니까?',
                },
                confirm: { type: 'plain_text', text: '취소하기' },
                deny: { type: 'plain_text', text: '닫기' },
              },
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:pending-requests',
      title: { type: 'plain_text', text: '교환 요청 현황' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 현재 배정과 교환 가능한 다른 배정만 선택지로 노출한다.
  static tradeTargetModal(
    myAssignment: AssignmentDetail,
    targets: AssignmentDetail[],
  ): View {
    if (targets.length === 0) {
      return {
        type: 'modal',
        callback_id: 'cleaning:modal:trade-no-target',
        title: { type: 'plain_text', text: '교환 요청' },
        close: { type: 'plain_text', text: '닫기' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${myAssignment.cleaningDate}* (${myAssignment.resourceName}) 날짜와 교환 가능한 배정이 없습니다.`,
            },
          },
        ],
      };
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:trade',
      private_metadata: String(myAssignment.id),
      title: { type: 'plain_text', text: '교환 요청' },
      submit: { type: 'plain_text', text: '요청 보내기' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `내 배정: *${myAssignment.cleaningDate}* (${myAssignment.resourceName})\n교환할 상대방의 배정을 선택하세요.`,
          },
        },
        {
          type: 'input',
          block_id: 'target_block',
          label: { type: 'plain_text', text: '교환 대상' },
          element: {
            type: 'static_select',
            action_id: 'target_select',
            placeholder: { type: 'plain_text', text: '배정을 선택하세요' },
            options: targets.map((t) => ({
              text: {
                type: 'plain_text' as const,
                text: `${t.cleaningDate} — ${t.userName}${t.userCode ? ` (${t.userCode})` : ''}`,
              },
              value: String(t.id),
            })),
          },
        },
      ],
    };
  }

  static tradeRequestBlocks(
    requester: AssignmentDetail,
    target: AssignmentDetail,
    tradeId: number,
  ): KnownBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*청소 교환 요청*`,
            `<@${requester.userSlackId}>님이 청소 배정 교환을 요청했습니다.`,
            ``,
            `*요청자 날짜:* ${requester.cleaningDate} (${requester.resourceName})`,
            `*내 날짜:* ${target.cleaningDate} (${target.resourceName})`,
          ].join('\n'),
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '수락' },
            style: 'primary',
            action_id: 'cleaning:trade:accept',
            value: String(tradeId),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '거절' },
            style: 'danger',
            action_id: 'cleaning:trade:reject',
            value: String(tradeId),
          },
        ],
      },
    ];
  }

  // 요청자/대상자 관점에 따라 교환 결과 메시지의 기준 날짜를 바꿔 보여준다.
  static tradeResultBlocks(
    requester: AssignmentDetail,
    target: AssignmentDetail,
    accepted: boolean,
    perspective: 'requester' | 'target' = 'target',
    rejectorSlackId?: string,
  ): KnownBlock[] {
    const status = accepted ? '수락됨 ✅' : '거절됨 ❌';
    const [myAssignment, otherAssignment, otherLabel] =
      perspective === 'requester'
        ? [requester, target, '상대방 날짜']
        : [target, requester, '요청자 날짜'];
    const lines = [`*청소 교환 요청 — ${status}*`];
    if (!accepted) {
      if (rejectorSlackId) {
        lines.push(``, `<@${rejectorSlackId}>님이 교환 요청을 거절했습니다.`);
      }
    } else {
      lines.push(
        ``,
        `*${myAssignment.cleaningDate}* (${myAssignment.resourceName}) → *${otherAssignment.cleaningDate}* (${otherAssignment.resourceName})`,
      );
    }
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ];
  }

  static swapManageListModal(rules: RuleWithDetails[]): View {
    const blocks: View['blocks'] = [];

    if (rules.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 청소 규칙이 없습니다.' },
      });
    } else {
      for (const rule of rules) {
        blocks.push(
          {
            type: 'section',
            text: { type: 'mrkdwn', text: ruleInfoText(rule) },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '교환' },
              action_id: 'cleaning:swap:open-select',
              value: String(rule.id),
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:swap-list',
      title: { type: 'plain_text', text: '배정 교환' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 관리자 직접 교환은 실제로 충돌 없이 맞바꿀 수 있는 배정만 후보로 보여준다.
  static swapSelectModal(
    assignments: AssignmentDetail[],
    ruleLabel: string,
  ): View {
    if (assignments.length < 2) {
      return {
        type: 'modal',
        callback_id: 'cleaning:modal:swap-no-target',
        title: { type: 'plain_text', text: '배정 교환' },
        close: { type: 'plain_text', text: '닫기' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${ruleLabel}* 규칙에 교환 가능한 배정이 부족합니다. (최소 2개 필요)`,
            },
          },
        ],
      };
    }

    const assignedSet = new Set(
      assignments.map((a) => `${a.userId}:${a.scheduleId}`),
    );
    const isSwappable = (i: AssignmentDetail, j: AssignmentDetail) => {
      if (i.id === j.id) return false;
      if (i.scheduleId === j.scheduleId) return false;
      return (
        !assignedSet.has(`${i.userId}:${j.scheduleId}`) &&
        !assignedSet.has(`${j.userId}:${i.scheduleId}`)
      );
    };
    const swappable = assignments.filter((a) =>
      assignments.some((b) => isSwappable(a, b)),
    );

    if (swappable.length < 2) {
      return {
        type: 'modal',
        callback_id: 'cleaning:modal:swap-no-target',
        title: { type: 'plain_text', text: '배정 교환' },
        close: { type: 'plain_text', text: '닫기' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${ruleLabel}* 규칙에 교환 가능한 배정이 없습니다.`,
            },
          },
        ],
      };
    }

    const options = swappable.map((a) => ({
      text: {
        type: 'plain_text' as const,
        text: `${a.cleaningDate} — ${a.userName}${a.userCode ? ` (${a.userCode})` : ''}`,
      },
      value: String(a.id),
    }));

    return {
      type: 'modal',
      callback_id: 'cleaning:modal:swap',
      title: { type: 'plain_text', text: `배정 교환` },
      submit: { type: 'plain_text', text: '교환' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${ruleLabel}* 규칙에서 교환할 두 배정을 선택하세요.`,
          },
        },
        {
          type: 'input',
          block_id: 'first_block',
          label: { type: 'plain_text', text: '첫 번째 배정' },
          element: {
            type: 'static_select',
            action_id: 'first_select',
            placeholder: { type: 'plain_text', text: '배정을 선택하세요' },
            options,
          },
        },
        {
          type: 'input',
          block_id: 'second_block',
          label: { type: 'plain_text', text: '두 번째 배정' },
          element: {
            type: 'static_select',
            action_id: 'second_select',
            placeholder: { type: 'plain_text', text: '배정을 선택하세요' },
            options,
          },
        },
      ],
    };
  }
}
