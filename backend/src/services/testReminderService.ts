import prisma from '../utils/db.js';
import { sendTestReminderEmail } from './emailService.js';
import { buildInviteLink, formatExamDate } from './invitationService.js';

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // reminders aren't second-precision, unlike the exam timer sweep

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweepInFlight = false;

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
      include: {
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
      },
    });

    const dueInvitations = candidates.filter((invitation) => {
      const hoursUntilClose = (invitation.test.endTime!.getTime() - now.getTime()) / (60 * 60 * 1000);
      return hoursUntilClose <= invitation.test.reminderHoursBeforeClose;
    });

    for (const invitation of dueInvitations) {
      try {
        await sendTestReminderEmail({
          to: invitation.email,
          candidateName: invitation.name,
          testName: invitation.test.name,
          // Reuses the exact invite link/token originally sent — no new token minted.
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
