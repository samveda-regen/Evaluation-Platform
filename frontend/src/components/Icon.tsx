import dashboardSvg        from '../assets/assessment-icons/icons/dashboard-button.svg';
import totalAssessmentsSvg from '../assets/assessment-icons/icons/total-assessments.svg';
import activeAssessmentsSvg from '../assets/assessment-icons/icons/active-assessments.svg';
import questionLibrarySvg  from '../assets/assessment-icons/icons/question-library.svg';
import trustIntegritySvg   from '../assets/assessment-icons/icons/trust-and-integrity.svg';
import idSvg               from '../assets/assessment-icons/icons/id.svg';
import aiGenerateSvg       from '../assets/assessment-icons/icons/ai-generate.svg';
import bellSvg             from '../assets/assessment-icons/icons/bell.svg';
import notificationSvg     from '../assets/assessment-icons/icons/notification.svg';
import myProfileSvg        from '../assets/assessment-icons/icons/my-profile.svg';
import logoutSvg           from '../assets/assessment-icons/icons/logout.svg';
import searchSvg           from '../assets/assessment-icons/icons/search.svg';
import trustedSvg          from '../assets/assessment-icons/icons/trusted.svg';
import needsReviewSvg      from '../assets/assessment-icons/icons/needs-review.svg';
import highRiskSvg         from '../assets/assessment-icons/icons/high-risk.svg';
import averageTrustSvg     from '../assets/assessment-icons/icons/average-trust.svg';
import integrityHealthSvg  from '../assets/assessment-icons/icons/integrity-health.svg';
import mcqQuestionsSvg     from '../assets/assessment-icons/icons/mcq-questions.svg';
import codingSvg           from '../assets/assessment-icons/icons/coding.svg';
import behaviouralSvg      from '../assets/assessment-icons/icons/behavioural-questions.svg';
import usersSvg            from '../assets/assessment-icons/icons/users.svg';
import users2Svg           from '../assets/assessment-icons/icons/users-2.svg';
import userSvg             from '../assets/assessment-icons/icons/user.svg';
import chevronDownSvg      from '../assets/assessment-icons/icons/chevron-down.svg';
import arrowLeftSvg        from '../assets/assessment-icons/icons/arrow-left.svg';
import arrowRightSvg       from '../assets/assessment-icons/icons/arrow-right.svg';
import plusSvg             from '../assets/assessment-icons/icons/plus.svg';
import filterSvg           from '../assets/assessment-icons/icons/filter.svg';
import settingsSvg         from '../assets/assessment-icons/icons/settings.svg';
import eyeSvg              from '../assets/assessment-icons/icons/eye.svg';
import eyeOffSvg           from '../assets/assessment-icons/icons/eye-off.svg';
import trashSvg            from '../assets/assessment-icons/icons/trash.svg';
import clockSvg            from '../assets/assessment-icons/icons/clock.svg';
import calendarSvg         from '../assets/assessment-icons/icons/calendar.svg';
import chartSvg            from '../assets/assessment-icons/icons/chart.svg';
import downloadSvg         from '../assets/assessment-icons/icons/download.svg';
import uploadSvg           from '../assets/assessment-icons/icons/upload.svg';
import flagSvg             from '../assets/assessment-icons/icons/flag.svg';
import alertSvg            from '../assets/assessment-icons/icons/alert.svg';
import playSvg             from '../assets/assessment-icons/icons/play.svg';
import checkSvg            from '../assets/assessment-icons/icons/check.svg';
import xSvg                from '../assets/assessment-icons/icons/x.svg';
import dotsSvg             from '../assets/assessment-icons/icons/dots.svg';
import gridSvg             from '../assets/assessment-icons/icons/grid.svg';
import listSvg             from '../assets/assessment-icons/icons/list.svg';
import codeSvg             from '../assets/assessment-icons/icons/code.svg';
import brainSvg            from '../assets/assessment-icons/icons/brain.svg';
import awardSvg            from '../assets/assessment-icons/icons/award.svg';
import starSvg             from '../assets/assessment-icons/icons/star.svg';
import sparkSvg            from '../assets/assessment-icons/icons/spark.svg';
import shieldSvg           from '../assets/assessment-icons/icons/shield.svg';
import mailSvg             from '../assets/assessment-icons/icons/mail.svg';
import linkSvg             from '../assets/assessment-icons/icons/link.svg';
import copySvg             from '../assets/assessment-icons/icons/copy.svg';
import refreshSvg          from '../assets/assessment-icons/icons/refresh.svg';
import bookSvg             from '../assets/assessment-icons/icons/book.svg';
import docSvg              from '../assets/assessment-icons/icons/doc.svg';
import layersSvg           from '../assets/assessment-icons/icons/layers.svg';
import monitorSvg          from '../assets/assessment-icons/icons/monitor.svg';
import cameraSvg           from '../assets/assessment-icons/icons/camera.svg';
import camOffSvg           from '../assets/assessment-icons/icons/cam-off.svg';
import micSvg              from '../assets/assessment-icons/icons/mic.svg';
import phoneSvg            from '../assets/assessment-icons/icons/phone.svg';
import lockSvg             from '../assets/assessment-icons/icons/lock.svg';
import globeSvg            from '../assets/assessment-icons/icons/globe.svg';
import liveSvg             from '../assets/assessment-icons/icons/live.svg';
import pieSvg              from '../assets/assessment-icons/icons/pie.svg';
import targetSvg           from '../assets/assessment-icons/icons/target.svg';
import boltSvg             from '../assets/assessment-icons/icons/bolt.svg';
import helpSvg             from '../assets/assessment-icons/icons/help.svg';

export type IconName =
  | 'dashboard' | 'total-assessments' | 'active-assessments' | 'question-library'
  | 'trust-and-integrity' | 'id' | 'ai-generate' | 'bell' | 'notification'
  | 'my-profile' | 'logout' | 'search' | 'trusted' | 'needs-review' | 'high-risk'
  | 'average-trust' | 'integrity-health' | 'mcq-questions' | 'coding'
  | 'behavioural-questions' | 'users' | 'users-2' | 'user' | 'chevron-down' | 'arrow-left'
  | 'arrow-right' | 'plus' | 'filter' | 'settings' | 'eye' | 'eye-off' | 'trash'
  | 'clock' | 'calendar' | 'chart' | 'download' | 'upload' | 'flag' | 'alert'
  | 'play' | 'check' | 'x' | 'dots' | 'grid' | 'list' | 'code' | 'brain' | 'award'
  | 'star' | 'spark' | 'shield' | 'mail' | 'link' | 'copy' | 'refresh' | 'book'
  | 'doc' | 'layers' | 'monitor' | 'camera' | 'cam-off' | 'mic' | 'phone' | 'lock'
  | 'globe' | 'live' | 'pie' | 'target' | 'bolt' | 'help';

const ICON_MAP: Record<IconName, string> = {
  'dashboard':             dashboardSvg,
  'total-assessments':     totalAssessmentsSvg,
  'active-assessments':    activeAssessmentsSvg,
  'question-library':      questionLibrarySvg,
  'trust-and-integrity':   trustIntegritySvg,
  'id':                    idSvg,
  'ai-generate':           aiGenerateSvg,
  'bell':                  bellSvg,
  'notification':          notificationSvg,
  'my-profile':            myProfileSvg,
  'logout':                logoutSvg,
  'search':                searchSvg,
  'trusted':               trustedSvg,
  'needs-review':          needsReviewSvg,
  'high-risk':             highRiskSvg,
  'average-trust':         averageTrustSvg,
  'integrity-health':      integrityHealthSvg,
  'mcq-questions':         mcqQuestionsSvg,
  'coding':                codingSvg,
  'behavioural-questions': behaviouralSvg,
  'users':                 usersSvg,
  'users-2':               users2Svg,
  'user':                  userSvg,
  'chevron-down':          chevronDownSvg,
  'arrow-left':            arrowLeftSvg,
  'arrow-right':           arrowRightSvg,
  'plus':                  plusSvg,
  'filter':                filterSvg,
  'settings':              settingsSvg,
  'eye':                   eyeSvg,
  'eye-off':               eyeOffSvg,
  'trash':                 trashSvg,
  'clock':                 clockSvg,
  'calendar':              calendarSvg,
  'chart':                 chartSvg,
  'download':              downloadSvg,
  'upload':                uploadSvg,
  'flag':                  flagSvg,
  'alert':                 alertSvg,
  'play':                  playSvg,
  'check':                 checkSvg,
  'x':                     xSvg,
  'dots':                  dotsSvg,
  'grid':                  gridSvg,
  'list':                  listSvg,
  'code':                  codeSvg,
  'brain':                 brainSvg,
  'award':                 awardSvg,
  'star':                  starSvg,
  'spark':                 sparkSvg,
  'shield':                shieldSvg,
  'mail':                  mailSvg,
  'link':                  linkSvg,
  'copy':                  copySvg,
  'refresh':               refreshSvg,
  'book':                  bookSvg,
  'doc':                   docSvg,
  'layers':                layersSvg,
  'monitor':               monitorSvg,
  'camera':                cameraSvg,
  'cam-off':               camOffSvg,
  'mic':                   micSvg,
  'phone':                 phoneSvg,
  'lock':                  lockSvg,
  'globe':                 globeSvg,
  'live':                  liveSvg,
  'pie':                   pieSvg,
  'target':                targetSvg,
  'bolt':                  boltSvg,
  'help':                  helpSvg,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function Icon({ name, size = 20, className, style }: IconProps) {
  const src = ICON_MAP[name];
  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{ display: 'inline-block', flexShrink: 0, ...style }}
    />
  );
}
