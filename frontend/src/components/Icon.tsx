import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bolt,
  Brain,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Flag,
  Globe,
  Gauge,
  Grid3X3,
  HelpCircle,
  Layers,
  LibraryBig,
  Link,
  List,
  Lock,
  LogOut,
  Mail,
  Mic,
  Monitor,
  MoreHorizontal,
  PieChart,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  Upload,
  User,
  Users,
  UsersRound,
  Video,
  VideoOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import type React from 'react';

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

const ICON_MAP: Record<IconName, LucideIcon> = {
  dashboard: BarChart3,
  'total-assessments': FileText,
  'active-assessments': Activity,
  'question-library': LibraryBig,
  'trust-and-integrity': ShieldCheck,
  id: Shield,
  'ai-generate': Sparkles,
  bell: Bell,
  notification: Bell,
  'my-profile': User,
  logout: LogOut,
  search: Search,
  trusted: ShieldCheck,
  'needs-review': AlertTriangle,
  'high-risk': ShieldAlert,
  'average-trust': Gauge,
  'integrity-health': Activity,
  'mcq-questions': CheckCircle2,
  coding: Code2,
  'behavioural-questions': Brain,
  users: Users,
  'users-2': UsersRound,
  user: User,
  'chevron-down': ChevronDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  plus: Plus,
  filter: Filter,
  settings: Settings,
  eye: Eye,
  'eye-off': EyeOff,
  trash: Trash2,
  clock: Clock,
  calendar: Calendar,
  chart: BarChart3,
  download: Download,
  upload: Upload,
  flag: Flag,
  alert: AlertTriangle,
  play: Play,
  check: Check,
  x: X,
  dots: MoreHorizontal,
  grid: Grid3X3,
  list: List,
  code: Code2,
  brain: Brain,
  award: Award,
  star: Star,
  spark: Sparkles,
  shield: Shield,
  mail: Mail,
  link: Link,
  copy: Copy,
  refresh: RefreshCw,
  book: BookOpen,
  doc: FileText,
  layers: Layers,
  monitor: Monitor,
  camera: Camera,
  'cam-off': VideoOff,
  mic: Mic,
  phone: Phone,
  lock: Lock,
  globe: Globe,
  live: Video,
  pie: PieChart,
  target: Target,
  bolt: Bolt,
  help: HelpCircle,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function Icon({ name, size = 20, className, style }: IconProps) {
  const Lucide = ICON_MAP[name];
  return (
    <Lucide
      aria-hidden="true"
      width={size}
      height={size}
      strokeWidth={2}
      className={`app-icon ${className ?? ''}`.trim()}
      style={style}
    />
  );
}
