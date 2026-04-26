import type { View } from '@slack/types';
import { Resource, ResourceStatus, ResourceType } from './resource.entity';
import { BookingItem } from './resource.service';
import { toKST } from '../utils/date.util';
import { multiUsersSelectBlock } from '../common/blocks';

const ROOM_COLORS = [
  '%234285F4',
  '%23DB4437',
  '%230F9D58',
  '%23F4B400',
  '%239E69AF',
  '%23F6511D',
  '%2300BCD4',
  '%23E91E63',
];

const DURATION_OPTIONS = (() => {
  const options: {
    text: { type: 'plain_text'; text: string };
    value: string;
  }[] = [];
  for (let m = 15; m <= 240; m += 15) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const label =
      h > 0 ? (min > 0 ? `${h}시간 ${min}분` : `${h}시간`) : `${min}분`;
    options.push({
      text: { type: 'plain_text' as const, text: label },
      value: String(m),
    });
  }
  return options;
})();

export class ResourceView {
  static listModal(resources: Resource[]): View {
    const combinedCalendarUrl =
      resources.length > 0
        ? 'https://calendar.google.com/calendar/embed?' +
          resources
            .map(
              (r, i) =>
                `src=${encodeURIComponent(r.calendarId)}&color=${ROOM_COLORS[i % ROOM_COLORS.length]}`,
            )
            .join('&') +
          '&ctz=Asia%2FSeoul&mode=WEEK'
        : undefined;

    const blocks: View['blocks'] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '예약할 스터디룸을 선택하세요.',
        },
        ...(combinedCalendarUrl && {
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '전체 일정 보기 ❐' },
            url: combinedCalendarUrl,
            action_id: 'study-room:action:view-calendar',
          },
        }),
      },
      { type: 'divider' },
    ];

    if (resources.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 스터디룸이 없습니다.' },
      });
    } else {
      for (const [i, resource] of resources.entries()) {
        const color = ROOM_COLORS[i % ROOM_COLORS.length];
        const calendarUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(resource.calendarId)}&color=${color}&ctz=Asia%2FSeoul&mode=WEEK`;
        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: resource.description
                ? `*${resource.name}*\n${resource.description}`
                : `*${resource.name}*`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '예약' },
                style: 'primary',
                action_id: 'study-room:action:book',
                value: String(resource.id),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '일정 보기 ❐' },
                url: calendarUrl,
                action_id: 'study-room:action:view-calendar',
              },
            ],
          },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'study-room:modal:list',
      title: { type: 'plain_text', text: '스터디룸 예약' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

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

  static bookingModal(resource: Resource, calculatedEndTime?: string): View {
    return {
      type: 'modal',
      callback_id: 'study-room:modal:book',
      title: { type: 'plain_text', text: '예약하기' },
      submit: { type: 'plain_text', text: '예약' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({ roomId: resource.id }),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${resource.name}*` },
        },
        { type: 'divider' },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '목적' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            placeholder: { type: 'plain_text', text: '이용 목적을 입력하세요' },
          },
        },
        {
          type: 'input',
          block_id: 'date_block',
          label: { type: 'plain_text', text: '날짜' },
          element: {
            type: 'datepicker',
            action_id: 'date_select',
          },
        },
        {
          type: 'input',
          block_id: 'start_time_block',
          label: { type: 'plain_text', text: '시간' },
          hint: {
            type: 'plain_text',
            text: '15분 단위로 입력하세요 (예: 09:00, 09:15, 09:30)',
          },
          dispatch_action: true,
          element: {
            type: 'timepicker',
            action_id: 'start_time_select',
          },
        },
        {
          type: 'input',
          block_id: 'duration_block',
          label: { type: 'plain_text', text: '이용 시간' },
          dispatch_action: true,
          element: {
            type: 'static_select',
            action_id: 'duration_select',
            placeholder: { type: 'plain_text', text: '이용 시간 선택' },
            options: DURATION_OPTIONS,
          },
        },
        {
          type: 'context',
          block_id: 'end_time_context',
          elements: [
            {
              type: 'mrkdwn',
              text: calculatedEndTime
                ? `⏰ 종료 시간: *${calculatedEndTime}*`
                : '시작 시간과 이용 시간을 선택하면 종료 시간이 표시됩니다.',
            },
          ],
        },
        multiUsersSelectBlock({
          blockId: 'attendees_block',
          actionId: 'attendees_select',
          label: '참석자',
          placeholder: '참석자를 선택하세요',
          optional: true,
        }),
      ],
    };
  }

  static myBookingsModal(bookings: BookingItem[]): View {
    const blocks: View['blocks'] = [];

    if (bookings.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '예약 내역이 없습니다.' },
      });
    } else {
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

    return {
      type: 'modal',
      callback_id: 'study-room:modal:my-bookings',
      title: { type: 'plain_text', text: '내 예약' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static modifyBookingModal(
    booking: {
      calendarId: string;
      eventId: string;
      roomName: string;
      summary: string;
      startTime: Date;
      endTime: Date;
    },
    initialAttendeeSlackIds: string[] = [],
  ): View {
    const durationMinutes = Math.round(
      (booking.endTime.getTime() - booking.startTime.getTime()) / 60000,
    );
    const clampedDuration = Math.min(Math.max(durationMinutes, 15), 240);
    const snappedDuration = Math.round(clampedDuration / 15) * 15;

    const kstStart = toKST(booking.startTime);
    const dateStr = `${kstStart.getUTCFullYear()}-${String(kstStart.getUTCMonth() + 1).padStart(2, '0')}-${String(kstStart.getUTCDate()).padStart(2, '0')}`;
    const timeStr = `${String(kstStart.getUTCHours()).padStart(2, '0')}:${String(kstStart.getUTCMinutes()).padStart(2, '0')}`;

    return {
      type: 'modal',
      callback_id: 'study-room:modal:modify-booking',
      title: { type: 'plain_text', text: '예약 수정' },
      submit: { type: 'plain_text', text: '수정' },
      close: { type: 'plain_text', text: '취소' },
      private_metadata: JSON.stringify({
        calendarId: booking.calendarId,
        eventId: booking.eventId,
        roomName: booking.roomName,
      }),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${booking.roomName}*` },
        },
        { type: 'divider' },
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: '목적' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            initial_value: booking.summary,
            placeholder: { type: 'plain_text', text: '이용 목적을 입력하세요' },
          },
        },
        {
          type: 'input',
          block_id: 'date_block',
          label: { type: 'plain_text', text: '날짜' },
          element: {
            type: 'datepicker',
            action_id: 'date_select',
            initial_date: dateStr,
          },
        },
        {
          type: 'input',
          block_id: 'start_time_block',
          label: { type: 'plain_text', text: '시간' },
          hint: {
            type: 'plain_text',
            text: '15분 단위로 입력하세요 (예: 09:00, 09:15, 09:30)',
          },
          dispatch_action: true,
          element: {
            type: 'timepicker',
            action_id: 'start_time_select',
            initial_time: timeStr,
          },
        },
        {
          type: 'input',
          block_id: 'duration_block',
          label: { type: 'plain_text', text: '이용 시간' },
          dispatch_action: true,
          element: {
            type: 'static_select',
            action_id: 'duration_select',
            placeholder: { type: 'plain_text', text: '이용 시간 선택' },
            options: DURATION_OPTIONS,
            initial_option: DURATION_OPTIONS.find(
              (o) => o.value === String(snappedDuration),
            ),
          },
        },
        {
          type: 'context',
          block_id: 'end_time_context',
          elements: [
            {
              type: 'mrkdwn',
              text: `⏰ 종료 시간: *${String(toKST(booking.endTime).getUTCHours()).padStart(2, '0')}:${String(toKST(booking.endTime).getUTCMinutes()).padStart(2, '0')}*`,
            },
          ],
        },
        multiUsersSelectBlock({
          blockId: 'attendees_block',
          actionId: 'attendees_select',
          label: '참석자',
          placeholder: '참석자를 선택하세요',
          initialUsers: initialAttendeeSlackIds,
          optional: true,
        }),
      ],
    };
  }

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

  static classroomScheduleModal(resources: Resource[]): View {
    const combinedCalendarUrl =
      resources.length > 0
        ? 'https://calendar.google.com/calendar/embed?' +
          resources
            .map(
              (c, i) =>
                `src=${encodeURIComponent(c.calendarId)}&color=${ROOM_COLORS[i % ROOM_COLORS.length]}`,
            )
            .join('&') +
          '&ctz=Asia%2FSeoul&mode=WEEK'
        : undefined;

    const blocks: View['blocks'] = [];

    if (combinedCalendarUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '전체 교실 일정 보기 ❐' },
            url: combinedCalendarUrl,
            action_id: 'space:action:view-classroom-all',
          },
        ],
      });
    }

    if (resources.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 교실이 없습니다.' },
      });
    } else {
      for (const [i, resource] of resources.entries()) {
        const color = ROOM_COLORS[i % ROOM_COLORS.length];
        const calendarUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(resource.calendarId)}&color=${color}&ctz=Asia%2FSeoul&mode=WEEK`;
        const aliasText =
          resource.aliases?.length > 0
            ? `\n별칭: ${resource.aliases.join(', ')}`
            : '';

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: resource.description
                ? `*${resource.name}*${aliasText}\n${resource.description}`
                : `*${resource.name}*${aliasText}`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '일정 보기 ❐' },
              url: calendarUrl,
              action_id: `space:action:view-classroom-${resource.id}`,
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'space:modal:classroom-schedule',
      title: { type: 'plain_text', text: '교실 시간표' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

  static professorScheduleModal(resources: Resource[]): View {
    const combinedCalendarUrl =
      resources.length > 0
        ? 'https://calendar.google.com/calendar/embed?' +
          resources
            .map(
              (c, i) =>
                `src=${encodeURIComponent(c.calendarId)}&color=${ROOM_COLORS[i % ROOM_COLORS.length]}`,
            )
            .join('&') +
          '&ctz=Asia%2FSeoul&mode=WEEK'
        : undefined;

    const blocks: View['blocks'] = [];

    if (combinedCalendarUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '전체 교수 일정 보기 ❐' },
            url: combinedCalendarUrl,
            action_id: 'space:action:view-professor-all',
          },
        ],
      });
    }

    if (resources.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '등록된 교수 캘린더가 없습니다.' },
      });
    } else {
      for (const [i, resource] of resources.entries()) {
        const color = ROOM_COLORS[i % ROOM_COLORS.length];
        const calendarUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(resource.calendarId)}&color=${color}&ctz=Asia%2FSeoul&mode=WEEK`;
        const aliasText =
          resource.aliases?.length > 0
            ? `\n별칭: ${resource.aliases.join(', ')}`
            : '';

        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: resource.description
                ? `*${resource.name}*${aliasText}\n${resource.description}`
                : `*${resource.name}*${aliasText}`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '일정 보기 ❐' },
              url: calendarUrl,
              action_id: `space:action:view-professor-${resource.id}`,
            },
          },
          { type: 'divider' },
        );
      }
    }

    return {
      type: 'modal',
      callback_id: 'space:modal:professor-schedule',
      title: { type: 'plain_text', text: '교수 시간표' },
      close: { type: 'plain_text', text: '닫기' },
      blocks,
    };
  }

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
