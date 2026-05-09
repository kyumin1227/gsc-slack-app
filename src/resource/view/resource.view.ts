import type { View } from '@slack/types';
import { Resource, ResourceStatus, ResourceType } from '../resource.entity';
import { multiUsersSelectBlock } from '../../common/blocks';
import { BookingItem } from '../dto/study-room.dto';
import { ConsultationItem } from '../dto/professor.dto';
import { toKST } from '../../utils/date.util';

export class ResourceView {
  // 리소스 생성 모달
  static createModal(): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:create',
      title: { type: 'plain_text', text: '공간 등록' },
      submit: { type: 'plain_text', text: '등록' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          label: { type: 'plain_text', text: '이름' },
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            placeholder: {
              type: 'plain_text',
              text: '공간 이름 또는 교수 이름',
            },
          },
        },
        {
          type: 'input',
          block_id: 'type_block',
          label: { type: 'plain_text', text: '유형' },
          element: {
            type: 'static_select',
            action_id: 'type_select',
            placeholder: { type: 'plain_text', text: '유형을 선택하세요' },
            options: [
              {
                text: { type: 'plain_text', text: '스터디룸 (예약 가능)' },
                value: 'study_room',
              },
              {
                text: { type: 'plain_text', text: '교실 (시간표 자동 복제)' },
                value: 'classroom',
              },
              {
                text: { type: 'plain_text', text: '교수 (일정 미러링)' },
                value: 'professor',
              },
            ],
          },
        },
        {
          type: 'input',
          block_id: 'aliases_block',
          label: { type: 'plain_text', text: '별칭 (Alias)' },
          optional: true,
          hint: {
            type: 'plain_text',
            text: '쉼표로 구분해서 입력하세요. 이벤트 location의 / 앞(공간), / 뒤(교수)와 매핑됩니다.',
          },
          element: {
            type: 'plain_text_input',
            action_id: 'aliases_input',
            placeholder: {
              type: 'plain_text',
              text: '301강, 301호, 홍길동, Hong',
            },
          },
        },
        {
          type: 'input',
          block_id: 'description_block',
          label: { type: 'plain_text', text: '설명' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: '시설 정보, 수용 인원 등',
            },
          },
        },
        {
          type: 'input',
          block_id: 'is_default_block',
          label: { type: 'plain_text', text: '기본 공간' },
          optional: true,
          hint: {
            type: 'plain_text',
            text: '선택 시 alias가 없는 이벤트가 이 공간의 시간표에 자동으로 미러링됩니다.',
          },
          element: {
            type: 'checkboxes',
            action_id: 'is_default_checkbox',
            options: [
              {
                text: { type: 'plain_text', text: '기본 공간으로 지정' },
                value: 'true',
              },
            ],
          },
        },
      ],
    };
  }

  // 리소스 수정 모달 (기존 값 초기화 포함)
  static editModal(resource: Resource): View {
    const typeOptions = [
      {
        text: { type: 'plain_text' as const, text: '스터디룸 (예약 가능)' },
        value: 'study_room',
      },
      {
        text: { type: 'plain_text' as const, text: '교실 (시간표 자동 복제)' },
        value: 'classroom',
      },
      {
        text: { type: 'plain_text' as const, text: '교수 (일정 미러링)' },
        value: 'professor',
      },
    ];

    const currentTypeLabel =
      resource.type === ResourceType.CLASSROOM
        ? '교실 (시간표 자동 복제)'
        : resource.type === ResourceType.PROFESSOR
          ? '교수 (일정 미러링)'
          : '스터디룸 (예약 가능)';

    return {
      type: 'modal',
      callback_id: 'study-room:modal:edit',
      title: { type: 'plain_text', text: '리소스 수정' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({
        roomId: resource.id,
        roomName: resource.name,
        calendarId: resource.calendarId,
      }),
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          label: { type: 'plain_text', text: '이름' },
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            initial_value: resource.name,
          },
        },
        {
          type: 'input',
          block_id: 'type_block',
          label: { type: 'plain_text', text: '유형' },
          element: {
            type: 'static_select',
            action_id: 'type_select',
            options: typeOptions,
            initial_option: {
              text: { type: 'plain_text', text: currentTypeLabel },
              value: resource.type,
            },
          },
        },
        {
          type: 'input',
          block_id: 'aliases_block',
          label: { type: 'plain_text', text: '별칭 (Alias)' },
          optional: true,
          hint: {
            type: 'plain_text',
            text: '쉼표로 구분해서 입력하세요. 교수 유형은 / 뒤 텍스트로 매핑됩니다.',
          },
          element: {
            type: 'plain_text_input',
            action_id: 'aliases_input',
            initial_value: resource.aliases?.join(', ') ?? '',
            placeholder: { type: 'plain_text', text: '301강, 301호, 301' },
          },
        },
        {
          type: 'input',
          block_id: 'description_block',
          label: { type: 'plain_text', text: '설명' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            initial_value: resource.description ?? '',
            placeholder: {
              type: 'plain_text',
              text: '시설 정보, 수용 인원 등',
            },
          },
        },
        {
          type: 'input',
          block_id: 'booking_url_block',
          label: { type: 'plain_text', text: '예약 페이지 URL (교수 전용)' },
          optional: true,
          hint: {
            type: 'plain_text',
            text: '교수 유형에서만 사용. Google Calendar 예약 페이지 링크를 입력하세요.',
          },
          element: {
            type: 'plain_text_input',
            action_id: 'booking_url_input',
            initial_value: resource.bookingUrl ?? '',
            placeholder: {
              type: 'plain_text',
              text: 'https://calendar.google.com/calendar/appointments/...',
            },
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '📎 교수 예약 페이지 설정 방법 → <https://support.google.com/calendar/answer/10729749|Google Calendar 가이드>',
            },
          ],
        },
        {
          type: 'input',
          block_id: 'status_block',
          label: { type: 'plain_text', text: '상태' },
          element: {
            type: 'static_select',
            action_id: 'status_select',
            options: [
              {
                text: { type: 'plain_text', text: '활성' },
                value: ResourceStatus.ACTIVE,
              },
              {
                text: { type: 'plain_text', text: '비활성' },
                value: ResourceStatus.INACTIVE,
              },
            ],
            initial_option: {
              text: {
                type: 'plain_text',
                text:
                  resource.status === ResourceStatus.ACTIVE ? '활성' : '비활성',
              },
              value: resource.status,
            },
          },
        },
      ],
    };
  }

  // 리소스 관리 목록 모달 (수정/편집자/상태 토글/삭제 버튼 포함)
  static manageModal(resources: Resource[]): View {
    const blocks: View['blocks'] = [
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '+ 새 리소스 등록' },
            action_id: 'study-room:admin:open-create',
            style: 'primary',
          },
        ],
      },
      { type: 'divider' },
    ];

    if (resources.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 리소스가 없습니다.' },
      });
    } else {
      const typeLabels: Record<ResourceType, string> = {
        [ResourceType.STUDY_ROOM]: '스터디룸',
        [ResourceType.CLASSROOM]: '교실',
        [ResourceType.PROFESSOR]: '교수',
      };

      for (const resource of resources) {
        const meta = JSON.stringify({
          roomId: resource.id,
          roomName: resource.name,
          calendarId: resource.calendarId,
        });
        const statusLabel =
          resource.status === ResourceStatus.ACTIVE ? '활성' : '비활성';
        const defaultLabel = resource.isDefault ? ' `기본 공간`' : '';
        const typeLabel = typeLabels[resource.type] ?? resource.type;

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${resource.name}* \`${typeLabel}\` \`${statusLabel}\`${defaultLabel}${resource.description ? `\n${resource.description}` : ''}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정' },
                action_id: 'study-room:admin:open-edit',
                value: meta,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정자 관리' },
                action_id: 'study-room:admin:open-editors',
                value: meta,
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: resource.isDefault
                    ? '기본 공간 해제'
                    : '기본 공간 지정',
                },
                action_id: 'study-room:admin:toggle-default',
                style: resource.isDefault ? undefined : 'primary',
                value: meta,
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text:
                    resource.status === ResourceStatus.ACTIVE
                      ? '비활성화'
                      : '활성화',
                },
                action_id: 'study-room:admin:toggle-status',
                style:
                  resource.status === ResourceStatus.ACTIVE
                    ? 'danger'
                    : 'primary',
                value: meta,
                confirm:
                  resource.status === ResourceStatus.ACTIVE
                    ? {
                        title: { type: 'plain_text', text: '비활성화 확인' },
                        text: {
                          type: 'mrkdwn',
                          text: `*${resource.name}*을 비활성화하시겠습니까?\n예약 목록에서 숨겨집니다.`,
                        },
                        confirm: { type: 'plain_text', text: '비활성화' },
                        deny: { type: 'plain_text', text: '취소' },
                        style: 'danger',
                      }
                    : undefined,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '삭제' },
                action_id: 'study-room:admin:open-delete',
                style: 'danger',
                value: meta,
              },
            ],
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'study-room:modal:manage',
      title: { type: 'plain_text', text: '리소스 관리' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 캘린더 편집자 관리 모달
  static editorsModal(
    resource: Resource,
    initialEditorSlackIds: string[] = [],
  ): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:editors',
      title: { type: 'plain_text', text: '수정자 관리' },
      submit: { type: 'plain_text', text: '저장' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({
        roomId: resource.id,
        calendarId: resource.calendarId,
      }),
      blocks: [
        multiUsersSelectBlock({
          blockId: 'editors_block',
          actionId: 'editors_select',
          label: '수정자',
          placeholder: '수정자를 선택하세요',
          initialUsers: initialEditorSlackIds,
          optional: true,
        }),
      ],
    };
  }

  // 내 예약 통합 모달 (스터디룸 예약 + 교수 상담 합산 표시)
  static myBookingsModal(
    bookings: BookingItem[],
    consultations: ConsultationItem[] = [],
  ): View {
    const blocks: View['blocks'] = [];

    if (bookings.length === 0 && consultations.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '예약 내역이 없습니다.' },
      });
    }

    if (bookings.length > 0) {
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: '📚 스터디룸 예약', emoji: true },
      });
      for (const booking of bookings) {
        const start = toKST(booking.startTime);
        const end = toKST(booking.endTime);
        const dateStr = `${start.getUTCFullYear()}.${String(start.getUTCMonth() + 1).padStart(2, '0')}.${String(start.getUTCDate()).padStart(2, '0')}`;
        const startStr = `${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`;
        const endStr = `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`;
        const meta = JSON.stringify({
          calendarId: booking.calendarId,
          eventId: booking.eventId,
          roomName: booking.resourceName,
          startIso: booking.startTime.toISOString(),
          endIso: booking.endTime.toISOString(),
        });

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${booking.summary}*\n${booking.resourceName} | ${dateStr} ${startStr}~${endStr}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '수정' },
                action_id: 'study-room:action:modify',
                value: meta,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '취소' },
                action_id: 'study-room:action:cancel',
                style: 'danger',
                value: meta,
                confirm: {
                  title: { type: 'plain_text', text: '예약 취소' },
                  text: {
                    type: 'mrkdwn',
                    text: `*${booking.summary}* 예약을 취소하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
                  },
                  confirm: { type: 'plain_text', text: '취소하기' },
                  deny: { type: 'plain_text', text: '돌아가기' },
                  style: 'danger',
                },
              },
            ],
          },
          { type: 'divider' },
        );
      }
    }

    if (consultations.length > 0) {
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: '💬 교수 상담 예약', emoji: true },
      });
      for (const c of consultations) {
        const start = toKST(c.startTime);
        const end = toKST(c.endTime);
        const dateStr = `${start.getUTCFullYear()}.${String(start.getUTCMonth() + 1).padStart(2, '0')}.${String(start.getUTCDate()).padStart(2, '0')}`;
        const startStr = `${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`;
        const endStr = `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`;

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${c.summary}*\n${dateStr} ${startStr}~${endStr}`,
            },
          },
          {
            type: 'actions',
            elements: [
              ...(c.htmlLink
                ? [
                    {
                      type: 'button' as const,
                      text: {
                        type: 'plain_text' as const,
                        text: '캘린더에서 보기 ❐',
                      },
                      url: c.htmlLink,
                      action_id: `consultation:view-${start.getTime()}`,
                    },
                  ]
                : []),
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: '취소' },
                style: 'danger' as const,
                action_id: `consultation:cancel:${c.eventId}`,
                confirm: {
                  title: { type: 'plain_text' as const, text: '상담 취소' },
                  text: {
                    type: 'mrkdwn' as const,
                    text: `*${c.summary}* 예약을 취소할까요?\n교수님께 취소 알림이 전송됩니다.`,
                  },
                  confirm: { type: 'plain_text' as const, text: '취소하기' },
                  deny: { type: 'plain_text' as const, text: '돌아가기' },
                  style: 'danger' as const,
                },
              },
            ],
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'study-room:modal:my-bookings',
      title: { type: 'plain_text', text: '내 예약' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  // 리소스 삭제 확인 모달
  static deleteConfirmModal(roomId: number, roomName: string): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:delete',
      private_metadata: String(roomId),
      title: { type: 'plain_text', text: '리소스 삭제' },
      submit: { type: 'plain_text', text: '삭제' },
      close: { type: 'plain_text', text: '취소' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${roomName}*을 삭제하시겠습니까?\n\n⚠️ Google Calendar도 함께 삭제되며 되돌릴 수 없습니다.`,
          },
        },
      ],
    };
  }
}
