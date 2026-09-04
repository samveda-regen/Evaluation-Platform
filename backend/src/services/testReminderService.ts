import prisma from '../utils/db.js';
import { sendTestReminderEmail } from './emailService.js';
import { buildInviteLink, formatExamDate } from './invitationService.js';

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // reminders aren't second-precision, unlike the exam timer sweep

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweepInFlight = false;

type ReminderInvitation = {
  id: string;
  email: string;
  name: string;
  token: string;
  accessCode: string | null;
  test: {
    name: string;
    duration: number;
    endTime: Date | null;
    reminderEmailSubject: string | null;
    reminderEmailBody: string | null;
    reminderHoursBeforeClose: number;
    admin: { company: { name: string } | null } | null;
  };
};

const REMINDER_INVITATION_INCLUDE = {
  test: {
    select: {
      name: true,
      duration: true,
      endTime: true,
      reminderEmailSubject: true,
      reminderEmailBody: true,
      reminderHoursBeforeClose: true,
      admin: { select: { company: { select: { name: true } } } },
    },
  },
} as const;

// Emails one invited-but-not-started candidate their reminder, reusing the exact
// invite link/token originally sent — no new token minted — and stamps reminderSentAt
// so the automatic sweep won't email them again.
async function deliverReminder(invitation: ReminderInvitation): Promise<void> {
  await sendTestReminderEmail({
    to: invitation.email,
    candidateName: invitation.name,
    testName: invitation.test.name,
    testLink: buildInviteLink(invitation.token),
    accessCode: invitation.accessCode ?? '',
    closesAt: formatExamDate(invitation.test.endTime) ?? 'soon',
    companyName: invitation.test.admin?.company?.name ?? undefined,
    estimatedTime: `${invitation.test.duration} minutes`,
    reminderEmailSubject: invitation.test.reminderEmailSubject,
    reminderEmailBody: invitation.test.reminderEmailBody,
  });

  await prisma.testInvitation.update({
    where: { id: invitation.id },
    data: { reminderSentAt: new Date() },
  });
}

// Nudges candidates who were invited but never started, while their access window is
// closing soon. Only applies to tests with a fixed endTime — an open-ended test has no
// "closing soon" signal to react to. How far ahead of closing that is is configurable
// per test (Test.reminderHoursBeforeClose, default 24h) via the Reminder Email settings
// tab, so the "closing soon" window can't be expressed as a single SQL bound here — it's
// checked per row below instead. Gated by reminderSentAt so each invitation gets at most
// one reminder, regardless of how many sweeps run before the candidate acts.
export async function sweepInvitationReminders(): Promise<void> {
  if (sweepInFlight) return;
  sweepInFlight = true;
  try {
    const now = new Date();

    const candidates = await prisma.testInvitation.findMany({
      where: {
        status: 'SENT',
        consumedAt: null,
        reminderSentAt: null,
        test: {
          isActive: true,
          endTime: { gte: now },
        },
      },
      include: REMINDER_INVITATION_INCLUDE,
    });

    const dueInvitations = candidates.filter((invitation) => {
      const hoursUntilClose = (invitation.test.endTime!.getTime() - now.getTime()) / (60 * 60 * 1000);
      return hoursUntilClose <= invitation.test.reminderHoursBeforeClose;
    });

    for (const invitation of dueInvitations) {
      try {
        await deliverReminder(invitation as ReminderInvitation);
      } catch (error) {
        console.error(`Reminder email failed for invitation ${invitation.id} (${invitation.email}):`, error);
      }
    }
  } catch (error) {
    console.error('Invitation reminder sweep failed:', error);
  } finally {
    sweepInFlight = false;
  }
}

// Which not-yet-started candidates a "Manual send" targets:
//   - 'invited':    invited but never logged in (no attempt row yet)
//   - 'permission': logged in and sitting in the permission stage (attempt exists with
//                   status 'permission' — device/ID checks not finished, test not started)
//   - 'both':       either of the above
// A candidate who has actually started (status 'in_progress'/'submitted') always has
// consumedAt set, so the consumedAt: null filter below already excludes them.
export type ReminderAudience = 'invited' | 'permission' | 'both';

// Admin-triggered "Manual send" from the Reminder Email settings panel. Unlike the
// automatic sweep this ignores the timer entirely (no reminderHoursBeforeClose window,
// no fixed-endTime requirement) and the reminderSentAt gate, so an admin can nudge every
// candidate who hasn't started yet on demand. Still only targets active tests and
// invitations that were sent but never consumed.
export async function sendManualInvitationReminders(
  testId: string,
  audience: ReminderAudience = 'both',
): Promise<{ sent: number; failed: number }> {
  const invitations = await prisma.testInvitation.findMany({
    where: {
      testId,
      status: 'SENT',
      consumedAt: null,
      test: { isActive: true },
    },
    include: REMINDER_INVITATION_INCLUDE,
  });

  if (invitations.length === 0) return { sent: 0, failed: 0 };

  // Match invitations to attempts by candidate email, the same join the invitation
  // dashboard uses, so we can tell "never logged in" from "stuck in permission".
  const emails = Array.from(new Set(invitations.map((invitation) => invitation.email.toLowerCase())));
  const attempts = await prisma.testAttempt.findMany({
    where: { testId, candidate: { email: { in: emails } } },
    select: { status: true, candidate: { select: { email: true } } },
  });
  const attemptStatusByEmail = new Map<string, string>();
  for (const attempt of attempts) {
    attemptStatusByEmail.set(attempt.candidate.email.toLowerCase(), attempt.status);
  }

  const targets = invitations.filter((invitation) => {
    const inPermission = attemptStatusByEmail.get(invitation.email.toLowerCase()) === 'permission';
    const invitedOnly = !attemptStatusByEmail.has(invitation.email.toLowerCase());
    if (audience === 'permission') return inPermission;
    if (audience === 'invited') return invitedOnly;
    return inPermission || invitedOnly;
  });

  let sent = 0;
  let failed = 0;

  for (const invitation of targets) {
    try {
      await deliverReminder(invitation as ReminderInvitation);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Manual reminder email failed for invitation ${invitation.id} (${invitation.email}):`, error);
    }
  }

  return { sent, failed };
}

export function startInvitationReminderSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepInvitationReminders();
  }, SWEEP_INTERVAL_MS);
  void sweepInvitationReminders();
}

export function stopInvitationReminderSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
