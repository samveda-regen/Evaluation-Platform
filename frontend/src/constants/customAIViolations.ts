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

export const DEFAULT_CUSTOM_AI_VIOLATIONS = CUSTOM_AI_VIOLATION_OPTIONS.map(
  (option) => option.eventType
);

const ALIAS_MAP: Record<string, string> = {
  focus_loss: 'window_blur',
  window_exit: 'window_blur',
  full_screen_exit: 'fullscreen_exit',
  tab_change: 'tab_switch',
  copy_attempt: 'copy_paste_attempt',
  paste_attempt: 'copy_paste_attempt',
  copy_paste: 'copy_paste_attempt',
  dev_tools_open: 'devtools_open',
  external_monitor: 'secondary_monitor_detected',
  secondary_monitor: 'secondary_monitor_detected',
  secondary_screen: 'secondary_monitor_detected',
  multiple_face: 'multiple_faces',
  mobile_phone: 'phone_detected',
  phone: 'phone_detected',
};

export function normalizeAIViolationType(eventType: string): string {
  const normalized = (eventType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return normalized;
  return ALIAS_MAP[normalized] || normalized;
}

export function normalizeCustomAIViolationSelection(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_CUSTOM_AI_VIOLATIONS];
  }
  const allowedSet = new Set(DEFAULT_CUSTOM_AI_VIOLATIONS);
  const selected = Array.from(
    new Set(
      input
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeAIViolationType(item))
        .filter((item) => allowedSet.has(item))
    )
  );
  return selected;
}

