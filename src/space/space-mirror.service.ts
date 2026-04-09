import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { SpaceService } from './space.service';

const MIRRORED_BY_KEY = 'mirroredBy';
const MIRRORED_BY_VALUE = 'gsc-bot';
const SOURCE_EVENT_ID_KEY = 'sourceEventId';
// source 이벤트(과목 캘린더)에 저장 — 어느 공간 캘린더에 미러됐는지 추적
const MIRRORED_CALENDAR_ID_KEY = 'mirroredCalendarId';

@Injectable()
export class SpaceMirrorService {
  private readonly logger = new Logger(SpaceMirrorService.name);

  constructor(private readonly spaceService: SpaceService) {}

  /**
   * webhook 핸들러에서 각 이벤트마다 즉시 호출.
   * sourceCalendarId: 과목 캘린더 ID (source 이벤트 메타데이터 패치용)
   */
  async mirrorEvent(
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
  ): Promise<void> {
    if (event.recurringEventId) return; // 반복 이벤트 스킵

    if (event.status === 'cancelled') {
      // 삭제 케이스는 기존 로직으로 동작 — location 기반 검색으로 처리
      const location = event.location?.trim();
      if (!location) return;
      const space = await this.spaceService.findByAlias(location);
      if (!space) return;
      await this.deleteMirrorBySourceId(space.calendarId, event.id!);
      return;
    }

    const storedMirroredCalendarId =
      event.extendedProperties?.private?.[MIRRORED_CALENDAR_ID_KEY];

    const location = event.location?.trim();

    if (!location) {
      // location 제거됨 → 이전에 미러된 캘린더에서 삭제
      if (storedMirroredCalendarId) {
        await this.deleteMirrorBySourceId(storedMirroredCalendarId, event.id!);
        await GoogleCalendarUtil.patchEventPrivateExtendedProperty(
          sourceCalendarId,
          event.id!,
          { [MIRRORED_CALENDAR_ID_KEY]: '' },
        );
      }
      return;
    }

    const space = await this.spaceService.findByAlias(location);

    if (!space) {
      // 매핑되는 공간 없음 → 이전 미러만 정리
      if (storedMirroredCalendarId) {
        await this.deleteMirrorBySourceId(storedMirroredCalendarId, event.id!);
        await GoogleCalendarUtil.patchEventPrivateExtendedProperty(
          sourceCalendarId,
          event.id!,
          { [MIRRORED_CALENDAR_ID_KEY]: '' },
        );
      }
      return;
    }

    // 공간이 변경된 경우 이전 캘린더에서 미러 삭제
    if (
      storedMirroredCalendarId &&
      storedMirroredCalendarId !== space.calendarId
    ) {
      await this.deleteMirrorBySourceId(storedMirroredCalendarId, event.id!);
    }

    await this.upsertMirror(space.calendarId, event);

    // source 이벤트에 현재 미러 calendarId 기록 (변경됐을 때만)
    if (storedMirroredCalendarId !== space.calendarId) {
      await GoogleCalendarUtil.patchEventPrivateExtendedProperty(
        sourceCalendarId,
        event.id!,
        { [MIRRORED_CALENDAR_ID_KEY]: space.calendarId },
      );
    }
  }

  // 미러 이벤트인지 판별 (webhook suppress용)
  isMirroredEvent(event: calendar_v3.Schema$Event): boolean {
    return (
      event.extendedProperties?.private?.[MIRRORED_BY_KEY] === MIRRORED_BY_VALUE
    );
  }

  private async upsertMirror(
    calendarId: string,
    event: calendar_v3.Schema$Event,
  ): Promise<void> {
    const existingId = await this.findMirrorEventId(calendarId, event.id!);

    const extendedProperties: calendar_v3.Schema$Event['extendedProperties'] = {
      private: {
        [SOURCE_EVENT_ID_KEY]: event.id!,
        [MIRRORED_BY_KEY]: MIRRORED_BY_VALUE,
      },
    };

    if (existingId) {
      await GoogleCalendarUtil.updateMirrorEventAsServiceAccount(
        calendarId,
        existingId,
        {
          summary: event.summary ?? '',
          startDateTime: event.start?.dateTime ?? '',
          endDateTime: event.end?.dateTime ?? '',
          location: event.location ?? undefined,
          description: event.description ?? undefined,
          extendedProperties,
        },
      );
      this.logger.log(`Mirror updated: ${event.id} → ${calendarId}`);
    } else {
      await GoogleCalendarUtil.createMirrorEventAsServiceAccount(calendarId, {
        summary: event.summary ?? '',
        startDateTime: event.start?.dateTime ?? '',
        endDateTime: event.end?.dateTime ?? '',
        location: event.location ?? undefined,
        description: event.description ?? undefined,
        extendedProperties,
      });
      this.logger.log(`Mirror created: ${event.id} → ${calendarId}`);
    }
  }

  private async findMirrorEventId(
    calendarId: string,
    sourceEventId: string,
  ): Promise<string | null> {
    const events = await GoogleCalendarUtil.searchByExtendedProperty(
      calendarId,
      SOURCE_EVENT_ID_KEY,
      sourceEventId,
    );
    return events[0]?.id ?? null;
  }

  private async deleteMirrorBySourceId(
    calendarId: string,
    sourceEventId: string,
  ): Promise<void> {
    const mirrorId = await this.findMirrorEventId(calendarId, sourceEventId);
    if (!mirrorId) return;
    await GoogleCalendarUtil.deleteEventAsServiceAccount(calendarId, mirrorId);
    this.logger.log(`Mirror deleted: ${sourceEventId} from ${calendarId}`);
  }
}
