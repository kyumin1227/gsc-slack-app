import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { SpaceService } from './space.service';

const MIRRORED_BY_KEY = 'mirroredBy';
const MIRRORED_BY_VALUE = 'gsc-bot';
const SOURCE_EVENT_ID_KEY = 'sourceEventId';
// source 이벤트(과목 캘린더)에 저장 — 미러 추적용 메타데이터
const MIRRORED_CALENDAR_ID_KEY = 'mirroredCalendarId';
const MIRRORED_EVENT_ID_KEY = 'mirroredEventId';

@Injectable()
export class SpaceMirrorService {
  private readonly logger = new Logger(SpaceMirrorService.name);

  constructor(private readonly spaceService: SpaceService) {}

  /**
   * debounce 발사 시점에 호출.
   * sourceCalendarId: 과목 캘린더 ID (source 이벤트 메타데이터 패치용)
   */
  async mirrorEvent(
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
  ): Promise<void> {
    if (event.recurringEventId) return; // 반복 이벤트 스킵

    if (event.status === 'cancelled') {
      // 취소된 이벤트는 webhook payload에 extendedProperties 없을 수 있음 → source 이벤트 직접 조회
      const sourceEvent = await GoogleCalendarUtil.getEventById(
        sourceCalendarId,
        event.id!,
      );
      if (!sourceEvent) return;

      const mirroredCalendarId =
        sourceEvent.extendedProperties?.private?.[MIRRORED_CALENDAR_ID_KEY];
      const mirroredEventId =
        sourceEvent.extendedProperties?.private?.[MIRRORED_EVENT_ID_KEY];
      if (!mirroredCalendarId || !mirroredEventId) return;

      await GoogleCalendarUtil.deleteEventAsServiceAccount(
        mirroredCalendarId,
        mirroredEventId,
      ).catch(() => {
        // 이미 삭제됐어도 무시
      });
      this.logger.log(`Mirror deleted: ${event.id} from ${mirroredCalendarId}`);
      return;
    }

    const storedMirroredCalendarId =
      event.extendedProperties?.private?.[MIRRORED_CALENDAR_ID_KEY];
    const storedMirroredEventId =
      event.extendedProperties?.private?.[MIRRORED_EVENT_ID_KEY];

    const location = event.location?.trim();

    if (!location) {
      // location 제거됨 → 이전에 미러된 이벤트 삭제
      if (storedMirroredCalendarId && storedMirroredEventId) {
        await GoogleCalendarUtil.deleteEventAsServiceAccount(
          storedMirroredCalendarId,
          storedMirroredEventId,
        ).catch(() => {});
        await GoogleCalendarUtil.patchEventPrivateExtendedProperty(
          sourceCalendarId,
          event.id!,
          { [MIRRORED_CALENDAR_ID_KEY]: '', [MIRRORED_EVENT_ID_KEY]: '' },
        );
        this.logger.log(
          `Mirror deleted (location removed): ${event.id} from ${storedMirroredCalendarId}`,
        );
      }
      return;
    }

    const space = await this.spaceService.findByAlias(location);

    if (!space) {
      // 매핑되는 공간 없음 → 이전 미러만 정리
      if (storedMirroredCalendarId && storedMirroredEventId) {
        await GoogleCalendarUtil.deleteEventAsServiceAccount(
          storedMirroredCalendarId,
          storedMirroredEventId,
        ).catch(() => {});
        await GoogleCalendarUtil.patchEventPrivateExtendedProperty(
          sourceCalendarId,
          event.id!,
          { [MIRRORED_CALENDAR_ID_KEY]: '', [MIRRORED_EVENT_ID_KEY]: '' },
        );
        this.logger.log(
          `Mirror deleted (no space match): ${event.id} from ${storedMirroredCalendarId}`,
        );
      }
      return;
    }

    // 공간이 변경된 경우 이전 캘린더에서 미러 삭제
    if (
      storedMirroredCalendarId &&
      storedMirroredCalendarId !== space.calendarId &&
      storedMirroredEventId
    ) {
      await GoogleCalendarUtil.deleteEventAsServiceAccount(
        storedMirroredCalendarId,
        storedMirroredEventId,
      ).catch(() => {});
      this.logger.log(
        `Mirror deleted (space changed): ${event.id} from ${storedMirroredCalendarId}`,
      );
    }

    // 같은 공간이면 기존 mirroredEventId 재사용, 아니면 null(새로 생성)
    const existingMirrorEventId =
      storedMirroredCalendarId === space.calendarId
        ? (storedMirroredEventId ?? null)
        : null;

    await this.upsertMirror(
      space.calendarId,
      event,
      sourceCalendarId,
      existingMirrorEventId,
    );
  }

  /**
   * 알림 발송 전 현재 미러 이벤트를 조회해 "변경 전" 상태로 반환.
   * 미러가 없거나 location 없는 이벤트면 null 반환.
   */
  async fetchCurrentMirrorEvent(
    event: calendar_v3.Schema$Event,
  ): Promise<calendar_v3.Schema$Event | null> {
    if (event.recurringEventId) return null;

    const mirroredCalendarId =
      event.extendedProperties?.private?.[MIRRORED_CALENDAR_ID_KEY];
    const mirroredEventId =
      event.extendedProperties?.private?.[MIRRORED_EVENT_ID_KEY];
    if (!mirroredCalendarId || !mirroredEventId) return null;

    return GoogleCalendarUtil.getEventById(mirroredCalendarId, mirroredEventId);
  }

  // 미러 이벤트인지 판별 (webhook suppress용)
  isMirroredEvent(event: calendar_v3.Schema$Event): boolean {
    return (
      event.extendedProperties?.private?.[MIRRORED_BY_KEY] === MIRRORED_BY_VALUE
    );
  }

  private async upsertMirror(
    spaceCalendarId: string,
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
    existingMirrorEventId: string | null,
  ): Promise<void> {
    const extendedProperties: calendar_v3.Schema$Event['extendedProperties'] = {
      private: {
        [SOURCE_EVENT_ID_KEY]: event.id!,
        [MIRRORED_BY_KEY]: MIRRORED_BY_VALUE,
      },
    };

    if (existingMirrorEventId) {
      await GoogleCalendarUtil.updateMirrorEventAsServiceAccount(
        spaceCalendarId,
        existingMirrorEventId,
        {
          summary: event.summary ?? '',
          startDateTime: event.start?.dateTime ?? '',
          endDateTime: event.end?.dateTime ?? '',
          location: event.location ?? undefined,
          description: event.description ?? undefined,
          extendedProperties,
        },
      );
      this.logger.log(`Mirror updated: ${event.id} → ${spaceCalendarId}`);
    } else {
      const newMirrorId =
        await GoogleCalendarUtil.createMirrorEventAsServiceAccount(
          spaceCalendarId,
          {
            summary: event.summary ?? '',
            startDateTime: event.start?.dateTime ?? '',
            endDateTime: event.end?.dateTime ?? '',
            location: event.location ?? undefined,
            description: event.description ?? undefined,
            extendedProperties,
          },
        );
      // source 이벤트에 mirroredCalendarId + mirroredEventId 함께 저장
      // → 이후 events.get()으로 즉시 조회 가능 (검색 인덱스 지연 없음)
      await GoogleCalendarUtil.patchEventPrivateExtendedProperty(
        sourceCalendarId,
        event.id!,
        {
          [MIRRORED_CALENDAR_ID_KEY]: spaceCalendarId,
          [MIRRORED_EVENT_ID_KEY]: newMirrorId,
        },
      );
      this.logger.log(`Mirror created: ${event.id} → ${spaceCalendarId}`);
    }
  }
}
