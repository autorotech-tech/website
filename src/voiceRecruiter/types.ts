export type InterviewPhase =
  | 'idle'
  | 'needKey'
  | 'chooseRole'
  | 'asking'
  | 'recording'
  | 'processing'
  | 'evaluating'
  | 'done'

export type ChatRole = 'assistant' | 'user' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  at: number
}

export interface CandidateEvaluation {
  overall: string
  strengths: string
  weaknesses: string
  development: string
  recommendation: string
  raw: string
}

export const JOB_ROLES = [
  'Python-разработчик',
  'Менеджер по продажам',
  'HR-менеджер',
  'Маркетолог',
  'Аналитик',
] as const

export type JobRole = (typeof JOB_ROLES)[number]

export const API_KEY_STORAGE = 'voice-recruiter-swoop-api-key'
export const DEFAULT_LLM_MODEL = 'glm/glm-4-flash'
export const TARGET_QUESTION_COUNT = 7
