import { KnownBlock } from '@slack/web-api';
import { calendar_v3 } from 'googleapis';

export type EventChangeType = 'cancelled' | 'added' | 'updated';

export interface EventSnapshot {
  summary?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  location?: string | null;
}

export function detectChangeType(
  event: calendar_v3.Schema$Event,
): EventChangeType {
  if (event.status === 'cancelled') return 'cancelled';
  const updated = event.updated ? new Date(event.updated).getTime() : 0;
  const created = event.created ? new Date(event.created).getTime() : 0;
  return Math.abs(updated - created) <= 10_000 ? 'added' : 'updated';
}

function formatDate(dt: string): string {
  return new Date(dt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dt: string): string {
  return new Date(dt).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatUpdated(dt: string): string {
  return new Date(dt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDateTimeFromEvent(event: calendar_v3.Schema$Event): string {
  const startDt = event.start?.dateTime ?? event.start?.date;
  const endDt = event.end?.dateTime ?? event.end?.date;
  if (!startDt || !endDt) return '날짜 정보 없음';
  if (!event.start?.dateTime) return `${formatDate(startDt)} (종일)`;
  return `${formatDate(startDt)} ${formatTime(startDt)} ~ ${formatTime(endDt)}`;
}

function formatDateTimeFromSnapshot(snapshot: EventSnapshot): string {
  const { startDateTime, endDateTime } = snapshot;
  if (!startDateTime || !endDateTime) return '날짜 정보 없음';
  return `${formatDate(startDateTime)} ${formatTime(startDateTime)} ~ ${formatTime(endDateTime)}`;
}

function buildDiffBlock(
  before: EventSnapshot,
  after: calendar_v3.Schema$Event,
): KnownBlock | null {
  const lines: string[] = [];

  const beforeTitle = before.summary ?? '';
  const afterTitle = after.summary ?? '';
  if (beforeTitle !== afterTitle) {
    lines.push(`📌 *제목* : ~${beforeTitle || '(없음)'}~ → *${afterTitle || '(없음)'}*`);
  }

  const beforeTime = formatDateTimeFromSnapshot(before);
  const afterTime = formatDateTimeFromEvent(after);
  if (beforeTime !== afterTime) {
    lines.push(`🗓️ *일시* : ~${beforeTime}~ → *${afterTime}*`);
  }

  const beforeLocation = before.location ?? '';
  const afterLocation = after.location ?? '';
  if (beforeLocation !== afterLocation) {
    lines.push(
      `📍 *장소* : ~${beforeLocation || '미지정'}~ → *${afterLocation || '미지정'}*`,
    );
  }

  if (lines.length === 0) return null;

  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*변경 내용*\n${lines.join('\n')}`,
    },
  } as KnownBlock;
}

export function buildCalendarNotificationBlocks(
  scheduleName: string,
  event: calendar_v3.Schema$Event,
  changeType: EventChangeType,
  beforeEvent?: EventSnapshot,
): KnownBlock[] {
  const headerMap: Record<EventChangeType, string> = {
    cancelled: `🚫 [${scheduleName}] 일정 취소 안내`,
    added: `✨ [${scheduleName}] 일정 추가 안내`,
    updated: `🔄 [${scheduleName}] 일정 변경 안내`,
  };

  const startDt = event.start?.dateTime ?? event.start?.date;
  const endDt = event.end?.dateTime ?? event.end?.date;
  const isAllDay = !event.start?.dateTime;

  let dateTimeText: string;
  if (!startDt || !endDt) {
    dateTimeText = '🗓️ *일시*\n_날짜 정보 없음_';
  } else if (isAllDay) {
    dateTimeText = `🗓️ *일시*\n${formatDate(startDt)} *(종일)*`;
  } else {
    dateTimeText = `🗓️ *일시*\n${formatDate(startDt)} *${formatTime(startDt)} ~ ${formatTime(endDt)}*`;
  }

  const diffBlock =
    changeType === 'updated' && beforeEvent
      ? buildDiffBlock(beforeEvent, event)
      : null;

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerMap[changeType],
        emoji: true,
      },
    },
    { type: 'divider' },
    ...(diffBlock ? [diffBlock, { type: 'divider' } as KnownBlock] : []),
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📌 *일정 제목*\n*${event.summary ?? '(제목 없음)'}*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: dateTimeText,
        },
        {
          type: 'mrkdwn',
          text: `📍 *장소*\n${event.location ?? '_장소 미지정_'}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `📝 *추가 정보*\n${event.description ?? '_추가 정보가 없습니다._'}`,
        },
        {
          type: 'mrkdwn',
          text: `👤 *담당자*\n${event.creator?.email ?? '알 수 없음'}`,
        },
      ],
    },
    { type: 'divider' },
    ...(event.htmlLink
      ? [
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '구글 캘린더에서 보기',
                  emoji: true,
                },
                url: event.htmlLink,
              },
            ],
          },
        ]
      : []),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🕒 *최종 수정 시각:* ${event.updated ? formatUpdated(event.updated) : '알 수 없음'} | *Bannote Bot*`,
        },
      ],
    },
  ] as unknown as KnownBlock[];
}
