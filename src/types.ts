export type ItemKind = 'task' | 'contest' | 'exam' | 'other';
export type Kind = 'course' | ItemKind;

export interface Period {
  index: number;
  start: string;
  end: string;
}

export interface PeriodEditing {
  fixedDuration: boolean;
  duration: number;
  shiftFollowing: boolean;
}

export interface Term {
  name: string;
  /** 第 1 周周一，YYYY-MM-DD */
  startDate: string;
  totalWeeks: number;
  periods: Period[];
  periodEditing?: PeriodEditing;
}

export interface Course {
  id: string;
  title: string;
  teacher?: string;
  location?: string;
  /** 1 = 周一 … 7 = 周日 */
  weekday: number;
  startTime: string;
  endTime: string;
  periods?: number[];
  /** 上课周次，如 [1,2,3,...,16] */
  weeks: number[];
  color?: string;
  note?: string;
}

export interface Task {
  id: string;
  title: string;
  kind: ItemKind;
  /** 截止时间，本地时间 YYYY-MM-DDTHH:mm */
  due?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  note?: string;
  url?: string;
  done?: boolean;
  course?: string;
  createdAt: string;
}

export interface AppState {
  term: Term;
  courses: Course[];
  tasks: Task[];
}

export interface SettingsView {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  temperature: number;
  localMode?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ImportResult {
  courses: Course[];
  termStart?: string;
  notes: string[];
  tasks?: Task[];
}
