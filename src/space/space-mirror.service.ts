import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarUtil } from '../google/google-calendar.util';
import { SpaceService } from './space.service';

const MIRRORED_BY_KEY = 'mirroredBy';
const MIRRORED_BY_VALUE = 'gsc-bot';
const SOURCE_EVENT_ID_KEY = 'sourceEventId';

@Injectable()
export class SpaceMirrorService {
  private readonly logger = new Logger(SpaceMirrorService.name);

  constructor(private readonly spaceService: SpaceService) {}

  // webhook 핸들러에서 각 이벤트마다 즉시 호출 (알림 debounce와 독립)
  async mirrorEvent(event: calendar_v3.Schema$Event): Promise<void> {
    // 반복 이벤트 스킵 (이번 스코프 외)
    if (event.recurringEventId) return;

    const location = event.location?.trim();
    if (!location) return;

    const space = await this.spaceService.findByAlias(location);
    if (!space) return;

    const isCancelled = event.status === 'cancelled';

    if (isCancelled) {
      await this.deleteMirror(space.calendarId, event.id!);
    } else {
      await this.upsertMirror(space.calendarId, event);
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

  private async deleteMirror(
    calendarId: string,
    sourceEventId: string,
  ): Promise<void> {
    const mirrorId = await this.findMirrorEventId(calendarId, sourceEventId);
    if (!mirrorId) return;
    await GoogleCalendarUtil.deleteEventAsServiceAccount(calendarId, mirrorId);
    this.logger.log(`Mirror deleted: ${sourceEventId} from ${calendarId}`);
  }
}
