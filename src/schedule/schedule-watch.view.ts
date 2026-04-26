import { KnownBlock } from '@slack/web-api';
import { calendar_v3 } from 'googleapis';

export type EventChangeType = 'cancelled' | 'added' | 'updated';

export interface EventSnapshot {
  summary?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  location?: string | null;
  description?: string | null;
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
  return `${formatDate(startDt)} ${formatTime(startDt)} - ${formatTime(endDt)}`;
}

function formatDateTimeFromSnapshot(snapshot: EventSnapshot): string {
  const { startDateTime, endDateTime } = snapshot;
  if (!startDateTime || !endDateTime) return '날짜 정보 없음';
  return `${formatDate(startDateTime)} ${formatTime(startDateTime)} - ${formatTime(endDateTime)}`;
}

function parseLocationParts(location: string): {
  room: string;
  professor: string | null;
} {
  const slashIdx = location.indexOf('/');
  if (slashIdx === -1)
    return { room: location.trim(), professor: null };
  return {
    room: location.slice(0, slashIdx).trim(),
    professor: location.slice(slashIdx + 1).trim() || null,
  };
}

export function hasRelevantChanges(
  before: EventSnapshot,
  after: calendar_v3.Schema$Event,
): boolean {
  if ((before.summary ?? '') !== (after.summary ?? '')) return true;
  if ((before.location ?? '') !== (after.location ?? '')) return true;
  if ((before.description ?? '') !== (after.description ?? '')) return true;

  const beforeStart = before.startDateTime ?? '';
  const beforeEnd = before.endDateTime ?? '';
  const afterStart = after.start?.dateTime ?? after.start?.date ?? '';
  const afterEnd = after.end?.dateTime ?? after.end?.date ?? '';
  if (beforeStart !== afterStart || beforeEnd !== afterEnd) return true;

  return false;
}

export function buildCalendarNotificationBlocks(
  scheduleName: string,
  event: calendar_v3.Schema$Event,
  changeType: EventChangeType,
  beforeEvent?: EventSnapshot,
  writerDisplay?: string,
): KnownBlock[] {
  const headerMap: Record<EventChangeType, string> = {
    cancelled: `🚫 [${scheduleName}] 일정 취소 안내`,
    added: `✨ [${scheduleName}] 일정 추가 안내`,
    updated: `🔄 [${scheduleName}] 일정 변경 안내`,
  };

  const diff = changeType === 'updated' && beforeEvent ? beforeEvent : null;

  // 제목
  const afterTitle = event.summary ?? '(제목 없음)';
  const titleChanged = diff && (diff.summary ?? '') !== (event.summary ?? '');
  let titleText: string;
  if (titleChanged) {
    titleText = `📌 *일정 제목* ✏️\n~${diff!.summary || '(없음)'}~ → *${afterTitle}*`;
  } else {
    titleText = `📌 *일정 제목*\n*${afterTitle}*`;
  }

  // 일시
  const startDt = event.start?.dateTime ?? event.start?.date;
  const endDt = event.end?.dateTime ?? event.end?.date;
  const isAllDay = !event.start?.dateTime;
  const afterTime = formatDateTimeFromEvent(event);

  let dateTimeText: string;
  if (!startDt || !endDt) {
    dateTimeText = '🗓️ *일시*\n_날짜 정보 없음_';
  } else if (diff) {
    const beforeTime = formatDateTimeFromSnapshot(diff);
    if (beforeTime !== afterTime) {
      dateTimeText = `🗓️ *일시* ✏️\n~${beforeTime}~\n→ *${afterTime}*`;
    } else if (isAllDay) {
      dateTimeText = `🗓️ *일시*\n${formatDate(startDt)} *(종일)*`;
    } else {
      dateTimeText = `🗓️ *일시*\n${formatDate(startDt)} *${formatTime(startDt)} - ${formatTime(endDt)}*`;
    }
  } else if (isAllDay) {
    dateTimeText = `🗓️ *일시*\n${formatDate(startDt)} *(종일)*`;
  } else {
    dateTimeText = `🗓️ *일시*\n${formatDate(startDt)} *${formatTime(startDt)} - ${formatTime(endDt)}*`;
  }

  // 장소 / 교수 분리
  const afterLocation = event.location ?? '';
  const { room: afterRoom, professor: afterProfessor } =
    parseLocationParts(afterLocation);
  const locationChanged = diff && (diff.location ?? '') !== afterLocation;

  let roomText: string;
  let professorText: string | null = null;

  if (locationChanged && diff) {
    const { room: beforeRoom, professor: beforeProfessor } =
      parseLocationParts(diff.location ?? '');

    roomText =
      beforeRoom !== afterRoom
        ? `📍 *장소* ✏️\n~${beforeRoom || '미지정'}~ → *${afterRoom || '미지정'}*`
        : `📍 *장소*\n${afterRoom || '_장소 미지정_'}`;

    if (beforeProfessor !== afterProfessor) {
      professorText = `👨‍🏫 *교수* ✏️\n~${beforeProfessor || '미지정'}~ → *${afterProfessor || '미지정'}*`;
    } else if (afterProfessor) {
      professorText = `👨‍🏫 *교수*\n${afterProfessor}`;
    }
  } else {
    roomText = `📍 *장소*\n${afterRoom || '_장소 미지정_'}`;
    if (afterProfessor) {
      professorText = `👨‍🏫 *교수*\n${afterProfessor}`;
    }
  }

  // 설명
  const afterDescription = event.description ?? '';
  const descriptionChanged =
    diff && (diff.description ?? '') !== afterDescription;
  const descriptionText = descriptionChanged
    ? `📝 *추가 정보* ✏️\n~${diff!.description || '(없음)'}~ → ${afterDescription || '_(없음)_'}`
    : `📝 *추가 정보*\n${afterDescription || '_추가 정보가 없습니다._'}`;

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
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: titleText },
        { type: 'mrkdwn', text: dateTimeText },
      ],
    },
    professorText
      ? {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: roomText },
            { type: 'mrkdwn', text: professorText },
          ],
        }
      : {
          type: 'section',
          text: { type: 'mrkdwn', text: roomText },
        },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: descriptionText,
        },
        {
          type: 'mrkdwn',
          text: `👥 *담당자*\n${writerDisplay ?? '알 수 없음'}`,
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
                  text: '구글 캘린더에서 보기 ❐',
                  emoji: true,
                },
                url: event.htmlLink,
                action_id: 'notification:open-calendar',
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
          text: `*최종 수정 시각:* ${event.updated ? formatUpdated(event.updated) : '알 수 없음'} | *Bannote Bot*`,
        },
      ],
    },
  ] as unknown as KnownBlock[];
}
