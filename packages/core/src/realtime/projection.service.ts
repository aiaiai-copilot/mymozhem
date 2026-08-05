import { Injectable } from '@nestjs/common';
import type { LogEvent } from '@prisma/client';
import {
  appSettingsVisibilityMap,
  projectedEventSchema,
  type AppManifest,
  type ProjectedEvent,
  type Visibility,
} from '@mymozhem/sdk';

// Наружные уровни запрашивающего (design §2): module-private — уровень ядра/модуля,
// наружу не проецируется НИКОГДА (REQ-CORE-005), поэтому уровня подписчика всего два.
export type OutwardLevel = 'public' | 'organizer';

const VISIBLE_TO: Record<OutwardLevel, readonly LogEvent['visibility'][]> = {
  public: ['PUBLIC'],
  organizer: ['PUBLIC', 'ORGANIZER'],
};

const SETTINGS_VISIBLE_TO: Record<OutwardLevel, readonly Visibility[]> = {
  public: ['public'],
  organizer: ['public', 'organizer'],
};

// Единственное место построения видимости наружу (REQ-CORE-005): ручная фильтрация
// чувствительных полей в обработчиках как механизм сокрытия запрещена нормой —
// gateway (Task 7) пользуется только этими тремя функциями.
@Injectable()
export class ProjectionService {
  // Одно событие → наружная форма. parse по strictObject: лишний ключ — громкий
  // отказ, не тихий strip (конвенция SDK).
  projectEvent(event: Pick<LogEvent, 'type' | 'payload' | 'actorId'>): ProjectedEvent {
    return projectedEventSchema.parse({
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      actorId: event.actorId,
    });
  }

  projectEvents(events: readonly LogEvent[], level: OutwardLevel): ProjectedEvent[] {
    const visible = VISIBLE_TO[level];
    return events
      .filter((event) => visible.includes(event.visibility))
      .map((event) => this.projectEvent(event));
  }

  // REQ-CORE-008: appSettings проецируются по уровню запрашивающего наравне с
  // состоянием и событиями. Карта уровней — appSettingsVisibilityMap из SDK;
  // неаннотированное свойство и свойство вне схемы — module-private (fail-safe).
  projectAppSettings(
    settings: unknown,
    manifest: AppManifest | undefined,
    level: OutwardLevel,
  ): Record<string, unknown> {
    if (manifest === undefined || typeof settings !== 'object' || settings === null) {
      return {};
    }
    const visibilityMap = appSettingsVisibilityMap(manifest.appSettings);
    const allowed = SETTINGS_VISIBLE_TO[level];
    return Object.fromEntries(
      Object.entries(settings as Record<string, unknown>).filter(([key]) =>
        allowed.includes(visibilityMap[key] ?? 'module-private'),
      ),
    );
  }
}
