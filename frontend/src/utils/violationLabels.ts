const VIOLATION_LABELS: Record<string, string> = {
  phone_detected: 'Mobile Phone Detected',
  multiple_faces: 'Multiple Faces Detected',
  face_not_detected: 'No Person Visible',
  looking_away: 'Off-Screen Gaze',
  voice_detected: 'Voice Detected',
  camera_blocked: 'Camera Blocked',
  tab_switch: 'Tab Switch',
  fullscreen_exit: 'Window Exit / Fullscreen Exit',
  window_blur: 'Window Focus Lost',
  copy_paste_attempt: 'Copy/Paste Attempt',
  devtools_open: 'DevTools Opened',
  secondary_monitor_detected: 'Secondary Monitor Detected',
  external_monitor: 'External Monitor Detected',
  suspicious_audio: 'Suspicious Audio',
};

export function violationLabel(eventType: string): string {
  const key = (eventType || '').trim().toLowerCase();
  if (!key) return 'Unknown Violation';
  return VIOLATION_LABELS[key] || key.replace(/_/g, ' ');
}
