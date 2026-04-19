export type CustomAIViolationOption = {
  eventType: string;
  label: string;
  description: string;
};

export const CUSTOM_AI_VIOLATION_OPTIONS: CustomAIViolationOption[] = [
  {
    eventType: 'phone_detected',
    label: 'Mobile Detection',
    description: 'Detects mobile phone usage in front of the candidate.',
  },
  {
    eventType: 'multiple_faces',
    label: 'Multiple Face Detection',
    description: 'Flags when more than one face is visible.',
  },
  {
    eventType: 'face_not_detected',
    label: 'No Face Detection',
    description: 'Flags when no person is visible in the camera feed.',
  },
  {
    eventType: 'looking_away',
    label: 'Off-Screen Gaze',
    description: 'Detects sustained gaze away from the screen.',
  },
  {
    eventType: 'camera_blocked',
    label: 'Camera Blocked',
    description: 'Detects camera obstruction or disabled camera feed.',
  },
  {
    eventType: 'secondary_monitor_detected',
    label: 'Secondary Monitor Detection',
    description: 'Detects additional monitor or external screen usage.',
  },
  {
    eventType: 'tab_switch',
    label: 'Tab Switch',
    description: 'Detects switching away from the active exam tab.',
  },
  {
    eventType: 'window_blur',
    label: 'Window Focus Lost',
    description: 'Detects browser window focus loss.',
  },
  {
    eventType: 'fullscreen_exit',
    label: 'Fullscreen Exit',
    description: 'Detects exiting fullscreen mode during the exam.',
  },
  {
    eventType: 'copy_paste_attempt',
    label: 'Copy/Paste Attempt',
    description: 'Detects copy or paste attempts during the exam.',
  },
  {
    eventType: 'devtools_open',
    label: 'DevTools Open',
    description: 'Detects developer tools opening attempts.',
  },
  {
    eventType: 'voice_detected',
    label: 'Voice Detection',
    description: 'Detects voice activity when restricted.',
  },
  {
    eventType: 'suspicious_audio',
    label: 'Suspicious Audio',
    description: 'Detects unusual noise patterns around the candidate.',
  },
  {
    eventType: 'unauthorized_object_detected',
    label: 'Unauthorized Object',
    description: 'Detects unauthorized objects in the camera frame.',
  },
];

export const DEFAULT_CUSTOM_AI_VIOLATION_EVENTS: string[] = CUSTOM_AI_VIOLATION_OPTIONS.map(
  (option) => option.eventType
);

const CUSTOM_AI_VIOLATION_SET = new Set(DEFAULT_CUSTOM_AI_VIOLATION_EVENTS);

function normalizeEventType(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function parseIncomingArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      // Treat as comma-separated values.
    }

    return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
  }

  return [];
}

function sortByDefaultOrder(items: string[]): string[] {
  const order = new Map<string, number>(
    DEFAULT_CUSTOM_AI_VIOLATION_EVENTS.map((eventType, index) => [eventType, index])
  );
  return [...items].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

export function normalizeCustomAIViolationEvents(
  value: unknown,
  options: { fallbackToDefault?: boolean } = {}
): string[] {
  const fallbackToDefault = options.fallbackToDefault ?? false;
  const parsed = parseIncomingArray(value)
    .map(normalizeEventType)
    .filter((eventType) => CUSTOM_AI_VIOLATION_SET.has(eventType));

  const deduped = Array.from(new Set(parsed));
  if (deduped.length === 0) {
    return fallbackToDefault ? [...DEFAULT_CUSTOM_AI_VIOLATION_EVENTS] : [];
  }

  return sortByDefaultOrder(deduped);
}

export function parseStoredCustomAIViolationEvents(value: string | null | undefined): string[] {
  if (value === null || value === undefined) {
    return [...DEFAULT_CUSTOM_AI_VIOLATION_EVENTS];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [...DEFAULT_CUSTOM_AI_VIOLATION_EVENTS];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeCustomAIViolationEvents(parsed);
    }
  } catch {
    // Legacy or malformed stored values fall back to normalized string parsing.
  }

  return normalizeCustomAIViolationEvents(trimmed, { fallbackToDefault: true });
}
