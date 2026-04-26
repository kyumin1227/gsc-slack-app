import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { GoogleCalendarService } from '../google/google-calendar.service';
import { ResourceService } from './resource.service';
import { Resource } from './resource.entity';

const MIRRORED_BY_KEY = 'mirroredBy';
const MIRRORED_BY_VALUE = 'gsc-bot';
const SOURCE_EVENT_ID_KEY = 'sourceEventId';
// JSON: [{calendarId, eventId}, ...] — 복수 리소스 미러 추적
const MIRRORED_TARGETS_KEY = 'mirroredTargets';

interface MirrorTarget {
  calendarId: string;
  eventId: string;
}

@Injectable()
export class ResourceMirrorService {
  private readonly logger = new Logger(ResourceMirrorService.name);

  constructor(
    private readonly resourceService: ResourceService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  // 위치 문자열을 '/' 기준으로 분리
  // '세미나실 A / 홍길동' → { roomPart: '세미나실 A', professorPart: '홍길동' }
  // '세미나실 A' → { roomPart: '세미나실 A', professorPart: null }
  private parseLocation(location: string): {
    roomPart: string | null;
    professorPart: string | null;
  } {
    const slashIdx = location.indexOf('/');
    if (slashIdx === -1) {
      return { roomPart: location.trim() || null, professorPart: null };
    }
    return {
      roomPart: location.slice(0, slashIdx).trim() || null,
      professorPart: location.slice(slashIdx + 1).trim() || null,
    };
  }

  private parseMirroredTargets(raw: string | undefined): MirrorTarget[] {
    if (!raw) return [];
    try {
      return JSON.parse(raw) as MirrorTarget[];
    } catch {
      return [];
    }
  }

  isMirroredEvent(event: calendar_v3.Schema$Event): boolean {
    return (
      event.extendedProperties?.private?.[MIRRORED_BY_KEY] === MIRRORED_BY_VALUE
    );
  }

  async fetchCurrentMirrorEvent(
    event: calendar_v3.Schema$Event,
  ): Promise<calendar_v3.Schema$Event | null> {
    if (event.recurringEventId) return null;

    const rawTargets =
      event.extendedProperties?.private?.[MIRRORED_TARGETS_KEY];
    const targets = this.parseMirroredTargets(rawTargets);
    if (targets.length === 0) return null;

    // 첫 번째 미러 이벤트를 기준으로 "변경 전" 상태 반환 (알림 diff용)
    const first = targets[0];
    return this.googleCalendarService.getEventById(
      first.calendarId,
      first.eventId,
    );
  }

  async mirrorEvent(
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
  ): Promise<void> {
    if (event.recurringEventId) return;

    if (event.status === 'cancelled') {
      await this.handleCancelledEvent(event, sourceCalendarId);
      return;
    }

    const location = event.location?.trim();
    const targets: Resource[] = [];

    if (location) {
      const { roomPart, professorPart } = this.parseLocation(location);

      const roomNames = roomPart
        ? roomPart.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const professorNames = professorPart
        ? professorPart.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      for (const alias of [...roomNames, ...professorNames]) {
        const resource = await this.resourceService.findByAlias(alias);
        if (resource && !targets.some((t) => t.id === resource.id)) {
          targets.push(resource);
        }
      }
    }

    if (targets.length === 0) {
      const def = await this.resourceService.findDefault();
      if (def) targets.push(def);
    }

    this.logger.log(
      `Mirror targets: event=${event.id} location="${event.location ?? ''}" → [${targets.map((t) => t.name).join(', ') || 'none'}]`,
    );

    if (targets.length === 0) {
      // 타겟 없고 기존 미러도 있으면 정리
      await this.cleanupOrphanedMirrors(event, sourceCalendarId, []);
      return;
    }

    const rawTargets =
      event.extendedProperties?.private?.[MIRRORED_TARGETS_KEY];
    const existingTargets = this.parseMirroredTargets(rawTargets);

    // 더 이상 필요 없는 미러 삭제 (타겟 calendarId에 없는 것)
    const newCalendarIds = new Set(targets.map((t) => t.calendarId));
    for (const existing of existingTargets) {
      if (!newCalendarIds.has(existing.calendarId)) {
        await this.googleCalendarService
          .deleteEventAsServiceAccount(existing.calendarId, existing.eventId)
          .catch(() => {});
        this.logger.log(
          `Mirror deleted (target removed): ${event.id} from ${existing.calendarId}`,
        );
      }
    }

    // 각 타겟에 미러 upsert
    const updatedTargets: MirrorTarget[] = [];
    for (const target of targets) {
      const existingMirror = existingTargets.find(
        (e) => e.calendarId === target.calendarId,
      );
      const mirrorEventId = await this.upsertMirror(
        target,
        event,
        sourceCalendarId,
        existingMirror?.eventId ?? null,
      );
      updatedTargets.push({
        calendarId: target.calendarId,
        eventId: mirrorEventId,
      });
    }

    // source 이벤트에 최신 mirroredTargets 저장
    await this.googleCalendarService.patchEventPrivateExtendedProperty(
      sourceCalendarId,
      event.id!,
      { [MIRRORED_TARGETS_KEY]: JSON.stringify(updatedTargets) },
    );
  }

  private async handleCancelledEvent(
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
  ): Promise<void> {
    const sourceEvent = await this.googleCalendarService.getEventById(
      sourceCalendarId,
      event.id!,
    );
    if (!sourceEvent) return;

    const rawTargets =
      sourceEvent.extendedProperties?.private?.[MIRRORED_TARGETS_KEY];
    const targets = this.parseMirroredTargets(rawTargets);

    for (const target of targets) {
      await this.googleCalendarService
        .deleteEventAsServiceAccount(target.calendarId, target.eventId)
        .catch(() => {});
      this.logger.log(`Mirror deleted: ${event.id} from ${target.calendarId}`);
    }
  }

  private async cleanupOrphanedMirrors(
    event: calendar_v3.Schema$Event,
    sourceCalendarId: string,
    keepCalendarIds: string[],
  ): Promise<void> {
    const rawTargets =
      event.extendedProperties?.private?.[MIRRORED_TARGETS_KEY];
    const targets = this.parseMirroredTargets(rawTargets);
    const keepSet = new Set(keepCalendarIds);

    for (const target of targets) {
      if (!keepSet.has(target.calendarId)) {
        await this.googleCalendarService
          .deleteEventAsServiceAccount(target.calendarId, target.eventId)
          .catch(() => {});
        this.logger.log(
          `Mirror deleted (no target): ${event.id} from ${target.calendarId}`,
        );
      }
    }

    if (targets.length > 0) {
      await this.googleCalendarService.patchEventPrivateExtendedProperty(
        sourceCalendarId,
        event.id!,
        { [MIRRORED_TARGETS_KEY]: JSON.stringify([]) },
      );
    }
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
    target: Resource,
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
      const currentMirror = await this.googleCalendarService.getEventById(
        target.calendarId,
        existingMirrorEventId,
      );

      if (
        currentMirror &&
        currentMirror.status !== 'cancelled' &&
        this.isInSync(event, currentMirror)
      ) {
        this.logger.log(
          `Mirror in sync, skipping: ${event.id} → ${target.calendarId}`,
        );
        return existingMirrorEventId;
      }

      if (currentMirror && currentMirror.status !== 'cancelled') {
        await this.googleCalendarService.updateMirrorEventAsServiceAccount(
          target.calendarId,
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
        this.logger.log(`Mirror updated: ${event.id} → ${target.calendarId}`);
        return existingMirrorEventId;
      }

      this.logger.log(
        `Mirror missing or cancelled, recreating: ${event.id} (old: ${existingMirrorEventId})`,
      );
    }

    const newMirrorId =
      await this.googleCalendarService.createMirrorEventAsServiceAccount(
        target.calendarId,
        {
          summary: event.summary ?? '',
          startDateTime: event.start?.dateTime ?? '',
          endDateTime: event.end?.dateTime ?? '',
          location: event.location ?? undefined,
          description: event.description ?? undefined,
          extendedProperties,
        },
      );
    this.logger.log(
      `Mirror created: ${event.id} → ${target.calendarId} (${newMirrorId})`,
    );
    return newMirrorId;
  }
}
