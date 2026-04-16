import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarService } from '../google/google-calendar.service';
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

  constructor(
    private readonly spaceService: SpaceService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  /**
   * debounce 발사 시점에 호출.
   * sourceCalendarId: 과목 캘린더 ID (source 이벤트 메타데이터 패치용)
   */
  // 미러 이벤트 ID 반환 (생성/업데이트된 미러 ID, 삭제/스킵 시 null)
  async mirrorEvent(
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
  ): Promise<string | null> {
    if (event.recurringEventId) return null; // 반복 이벤트 스킵

    if (event.status === 'cancelled') {
      // 취소된 이벤트는 webhook payload에 extendedProperties 없을 수 있음 → source 이벤트 직접 조회
      const sourceEvent = await this.googleCalendarService.getEventById(
        sourceCalendarId,
        event.id!,
      );
      if (!sourceEvent) return null;

      const mirroredCalendarId =
        sourceEvent.extendedProperties?.private?.[MIRRORED_CALENDAR_ID_KEY];
      const mirroredEventId =
        sourceEvent.extendedProperties?.private?.[MIRRORED_EVENT_ID_KEY];
      if (!mirroredCalendarId || !mirroredEventId) return null;

      await this.googleCalendarService.deleteEventAsServiceAccount(
        mirroredCalendarId,
        mirroredEventId,
      ).catch(() => {
        // 이미 삭제됐어도 무시
      });
      this.logger.log(`Mirror deleted: ${event.id} from ${mirroredCalendarId}`);
      return null;
    }

    const storedMirroredCalendarId =
      event.extendedProperties?.private?.[MIRRORED_CALENDAR_ID_KEY];
    const storedMirroredEventId =
      event.extendedProperties?.private?.[MIRRORED_EVENT_ID_KEY];

    // 대상 공간 결정: alias 매칭 → 없으면 기본 공간 → 없으면 스킵
    const location = event.location?.trim();
    let targetSpace = location
      ? await this.spaceService.findByAlias(location)
      : null;
    if (!targetSpace) {
      targetSpace = await this.spaceService.findDefault();
    }

    if (!targetSpace) {
      // 대상 공간 없음 → 기존 미러 정리
      if (storedMirroredCalendarId && storedMirroredEventId) {
        await this.googleCalendarService.deleteEventAsServiceAccount(
          storedMirroredCalendarId,
          storedMirroredEventId,
        ).catch(() => {});
        await this.googleCalendarService.patchEventPrivateExtendedProperty(
          sourceCalendarId,
          event.id!,
          { [MIRRORED_CALENDAR_ID_KEY]: '', [MIRRORED_EVENT_ID_KEY]: '' },
        );
        this.logger.log(
          `Mirror deleted (no target space): ${event.id} from ${storedMirroredCalendarId}`,
        );
      }
      return null;
    }

    // 공간이 변경된 경우 이전 캘린더에서 미러 삭제
    if (
      storedMirroredCalendarId &&
      storedMirroredCalendarId !== targetSpace.calendarId &&
      storedMirroredEventId
    ) {
      await this.googleCalendarService.deleteEventAsServiceAccount(
        storedMirroredCalendarId,
        storedMirroredEventId,
      ).catch(() => {});
      this.logger.log(
        `Mirror deleted (space changed): ${event.id} from ${storedMirroredCalendarId}`,
      );
    }

    // 같은 공간이면 기존 mirroredEventId 재사용, 아니면 null(새로 생성)
    const existingMirrorEventId =
      storedMirroredCalendarId === targetSpace.calendarId
        ? (storedMirroredEventId ?? null)
        : null;

    return this.upsertMirror(
      targetSpace.calendarId,
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

    return this.googleCalendarService.getEventById(mirroredCalendarId, mirroredEventId);
  }

  // 미러 이벤트인지 판별 (webhook suppress용)
  isMirroredEvent(event: calendar_v3.Schema$Event): boolean {
    return (
      event.extendedProperties?.private?.[MIRRORED_BY_KEY] === MIRRORED_BY_VALUE
    );
  }

  private isInSync(
    source: calendar_v3.Schema$Event,
    mirror: calendar_v3.Schema$Event,
  ): boolean {
    return (
      (source.summary ?? '') === (mirror.summary ?? '') &&
      (source.start?.dateTime ?? source.start?.date ?? '') ===
        (mirror.start?.dateTime ?? mirror.start?.date ?? '') &&
      (source.end?.dateTime ?? '') === (mirror.end?.dateTime ?? '') &&
      (source.location ?? '') === (mirror.location ?? '') &&
      (source.description ?? '') === (mirror.description ?? '')
    );
  }

  private async upsertMirror(
    spaceCalendarId: string,
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
    existingMirrorEventId: string | null,
  ): Promise<string> {
    const extendedProperties: calendar_v3.Schema$Event['extendedProperties'] = {
      private: {
        [SOURCE_EVENT_ID_KEY]: event.id!,
        [MIRRORED_BY_KEY]: MIRRORED_BY_VALUE,
      },
    };

    if (existingMirrorEventId) {
      // 현재 미러 이벤트 조회 후 동일하면 패치 없이 스킵 (불필요한 webhook 방지)
      const currentMirror = await this.googleCalendarService.getEventById(
        spaceCalendarId,
        existingMirrorEventId,
      );

      // 미러가 살아있고 내용도 동일하면 스킵
      if (
        currentMirror &&
        currentMirror.status !== 'cancelled' &&
        this.isInSync(event, currentMirror)
      ) {
        this.logger.log(`Mirror in sync, skipping: ${event.id}`);
        return existingMirrorEventId;
      }

      // 미러가 살아있고 내용이 달라졌으면 업데이트
      if (currentMirror && currentMirror.status !== 'cancelled') {
        await this.googleCalendarService.updateMirrorEventAsServiceAccount(
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
        return existingMirrorEventId;
      }

      // 미러가 삭제(null)됐거나 cancelled 상태 → 새로 생성
      this.logger.log(
        `Mirror missing or cancelled, recreating: ${event.id} (old: ${existingMirrorEventId})`,
      );
    }

    const newMirrorId =
      await this.googleCalendarService.createMirrorEventAsServiceAccount(
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
    await this.googleCalendarService.patchEventPrivateExtendedProperty(
      sourceCalendarId,
      event.id!,
      {
        [MIRRORED_CALENDAR_ID_KEY]: spaceCalendarId,
        [MIRRORED_EVENT_ID_KEY]: newMirrorId,
      },
    );
    this.logger.log(
      `Mirror created: ${event.id} → ${spaceCalendarId}\nMirror Id: ${newMirrorId}`,
    );
    return newMirrorId;
  }
}
