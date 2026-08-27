import { useEffect, useRef, useState } from 'react'
import { chatCompletion, speakText, transcribeUpload, type LlmMessage } from './api'
import {
  buildStartUserPrompt,
  buildSystemPrompt,
  parseEvaluation,
  stripFinalMarkerForDisplay,
} from './prompts'
import {
  API_KEY_STORAGE,
  JOB_ROLES,
  type CandidateEvaluation,
  type ChatMessage,
  type InterviewPhase,
  type JobRole,
} from './types'

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function loadStoredKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export function VoiceRecruiterApp() {
  const [apiKey, setApiKey] = useState(loadStoredKey)
  const [keyDraft, setKeyDraft] = useState(loadStoredKey)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [role, setRole] = useState<JobRole | ''>('')
  const [phase, setPhase] = useState<InterviewPhase>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [llmHistory, setLlmHistory] = useState<LlmMessage[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [ttsMode, setTtsMode] = useState<'swoop' | 'browser' | ''>('')
  const [evaluation, setEvaluation] = useState<CandidateEvaluation | null>(null)
  const [answerCount, setAnswerCount] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const historyEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, evaluation])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    el.setAttribute('closedby', 'any')
    if (settingsOpen) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [settingsOpen])

  const pushMessage = (roleMsg: ChatMessage['role'], content: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: roleMsg, content, at: Date.now() }])
  }

  const saveApiKey = () => {
    const next = keyDraft.trim()
    setApiKey(next)
    try {
      if (next) localStorage.setItem(API_KEY_STORAGE, next)
      else localStorage.removeItem(API_KEY_STORAGE)
    } catch {
      /* ignore */
    }
    setSettingsOpen(false)
    setStatus(next ? 'API-ключ сохранён' : 'API-ключ очищен')
    if (phase === 'needKey' && next) setPhase('chooseRole')
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
  }

  const speakAssistant = async (key: string, text: string) => {
    const mode = await speakText(key, text)
    setTtsMode(mode)
    if (mode === 'browser') {
      setStatus('TTS Swoop недоступен — использован голос браузера')
    }
  }

  const startInterview = async () => {
    setError('')
    setEvaluation(null)
    setAnswerCount(0)
    setMessages([])
    setLlmHistory([])
    setTtsMode('')

    if (!apiKey.trim()) {
      setPhase('needKey')
      pushMessage(
        'assistant',
        'Добро пожаловать! Чтобы начать, откройте раздел «Настройки» и укажите API-ключ Autoro/Swoop (X-API-Key из Admin → Settings).',
      )
      setSettingsOpen(true)
      return
    }

    if (!role) {
      setPhase('chooseRole')
      pushMessage(
        'assistant',
        'Здравствуйте! Я AI-рекрутер Autoro. Выберите должность, на которую проводится собеседование, и нажмите «Начать собеседование» ещё раз.',
      )
      return
    }

    setPhase('processing')
    setStatus('Готовлю первый вопрос…')
    const system = buildSystemPrompt(role)
    const userStart = buildStartUserPrompt(role)
    const seed: LlmMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: userStart },
    ]

    try {
      const reply = await chatCompletion(apiKey, seed)
      const display = stripFinalMarkerForDisplay(reply)
      setLlmHistory([...seed, { role: 'assistant', content: reply }])
      pushMessage('assistant', display)
      setPhase('asking')
      setStatus('Задайте ответ голосом: «Начать запись» → говорите → «Ответить»')
      await speakAssistant(apiKey, display)
    } catch (err) {
      setPhase('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startRecording = async () => {
    setError('')
    if (!apiKey.trim()) {
      setPhase('needKey')
      setSettingsOpen(true)
      return
    }
    if (phase !== 'asking' && phase !== 'recording') {
      setError('Сначала начните собеседование и дождитесь вопроса рекрутера.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setPhase('recording')
      setStatus('Идёт запись… Нажмите «Ответить», когда закончите.')
    } catch (err) {
      setError(
        err instanceof Error
          ? `Микрофон недоступен: ${err.message}`
          : 'Микрофон недоступен',
      )
    }
  }

  const submitAnswer = async () => {
    setError('')
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      setError('Сначала нажмите «Начать запись» и скажите ответ.')
      return
    }

    setPhase('processing')
    setStatus('Останавливаю запись и распознаю речь…')

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        resolve(new Blob(chunksRef.current, { type }))
      }
      recorder.onerror = () => reject(new Error('recorder_error'))
      recorder.stop()
    })
    stopStream()

    if (blob.size < 200) {
      setPhase('asking')
      setError('Запись слишком короткая. Попробуйте ещё раз.')
      return
    }

    try {
      const transcript = await transcribeUpload(apiKey, blob)
      pushMessage('user', transcript)
      const nextHistory: LlmMessage[] = [
        ...llmHistory,
        { role: 'user', content: transcript },
      ]
      setAnswerCount((n) => n + 1)
      setStatus('Анализирую ответ…')

      const reply = await chatCompletion(apiKey, nextHistory)
      const evalBlock = parseEvaluation(reply)
      const display = stripFinalMarkerForDisplay(reply) || reply
      setLlmHistory([...nextHistory, { role: 'assistant', content: reply }])
      pushMessage('assistant', display)

      if (evalBlock) {
        setEvaluation(evalBlock)
        setPhase('done')
        setStatus('Собеседование завершено')
        await speakAssistant(apiKey, display)
      } else {
        setPhase('asking')
        setStatus('Готов следующий вопрос. Нажмите «Начать запись».')
        await speakAssistant(apiKey, display)
      }
    } catch (err) {
      setPhase('asking')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const phaseLabel: Record<InterviewPhase, string> = {
    idle: 'Ожидание',
    needKey: 'Нужен API-ключ',
    chooseRole: 'Выберите должность',
    asking: 'Ожидание ответа',
    recording: 'Запись',
    processing: 'Обработка',
    evaluating: 'Оценка',
    done: 'Завершено',
  }

  return (
    <div className="min-h-screen bg-[#f7f7f4] text-[#26251e]">
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 10% 0%, #ffe8dc 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 90% 10%, #e8f0ff 0%, transparent 50%)',
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm tracking-wide text-[#807d72]">Autoro / Swoop</p>
            <h1 className="mt-1 text-3xl font-normal tracking-tight sm:text-4xl">
              Голосовой AI-рекрутер
            </h1>
            <p className="mt-2 max-w-xl text-[#5a5852]">
              Voice → STT → LLM → TTS. Собеседование из нескольких вопросов с итоговой оценкой.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setKeyDraft(apiKey)
              setSettingsOpen(true)
            }}
            className="shrink-0 rounded-md border border-[#cfcdc4] bg-white px-3 py-2 text-sm hover:border-[#f54e00]"
          >
            ⚙️ Настройки
          </button>
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-sm text-[#807d72]">Должность</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as JobRole | '')}
              disabled={phase === 'processing' || phase === 'recording'}
              className="w-full rounded-md border border-[#cfcdc4] bg-white px-3 py-2.5 text-base outline-none focus:border-[#f54e00]"
            >
              <option value="">Выберите должность…</option>
              {JOB_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void startInterview()}
            disabled={phase === 'processing' || phase === 'recording'}
            className="rounded-md bg-[#f54e00] px-5 py-2.5 text-white hover:bg-[#d04200] disabled:opacity-50"
          >
            Начать собеседование
          </button>
        </section>

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[#5a5852]">
          <span className="rounded-full border border-[#e6e5e0] bg-white px-3 py-1">
            {phaseLabel[phase]}
          </span>
          {apiKey ? (
            <span className="text-[#1f8a65]">Ключ задан</span>
          ) : (
            <span className="text-[#cf2d56]">Ключ не задан</span>
          )}
          {answerCount > 0 && <span>Ответов: {answerCount}</span>}
          {ttsMode === 'swoop' && <span>TTS: Swoop</span>}
          {ttsMode === 'browser' && <span>TTS: браузер</span>}
        </div>

        <div className="mb-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={phase === 'processing' || phase === 'recording' || phase === 'done'}
            className="rounded-md border border-[#26251e] bg-white px-4 py-2.5 hover:bg-[#efeee8] disabled:opacity-40"
          >
            Начать запись
          </button>
          <button
            type="button"
            onClick={() => void submitAnswer()}
            disabled={phase !== 'recording'}
            className="rounded-md border border-[#f54e00] bg-white px-4 py-2.5 text-[#f54e00] hover:bg-[#fff1ea] disabled:opacity-40"
          >
            Ответить
          </button>
        </div>

        {status && <p className="mb-3 text-sm text-[#5a5852]">{status}</p>}
        {error && (
          <p className="mb-3 rounded-md border border-[#cf2d56]/40 bg-[#fff5f7] px-3 py-2 text-sm text-[#cf2d56]">
            {error}
          </p>
        )}

        <section
          className="flex min-h-[320px] flex-1 flex-col rounded-lg border border-[#e6e5e0] bg-white"
          aria-label="История диалога"
        >
          <div className="border-b border-[#e6e5e0] px-4 py-3 text-sm font-medium">
            История диалога
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="text-sm text-[#807d72]">
                Здесь появятся сообщения AI-рекрутера и ваши ответы после распознавания речи.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'ml-8 rounded-lg bg-[#f7f7f4] px-3 py-2 text-sm'
                    : 'mr-8 rounded-lg border border-[#e6e5e0] px-3 py-2 text-sm'
                }
              >
                <div className="mb-1 text-xs uppercase tracking-wide text-[#807d72]">
                  {m.role === 'user' ? 'Кандидат' : 'AI-рекрутер'}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
            {evaluation && (
              <div className="rounded-lg border border-[#f54e00]/40 bg-[#fff8f4] px-4 py-3 text-sm">
                <div className="mb-2 font-medium">Итоговая оценка</div>
                <p>
                  <strong>Общая оценка:</strong> {evaluation.overall || '—'}
                </p>
                <p className="mt-2">
                  <strong>Сильные стороны:</strong> {evaluation.strengths || '—'}
                </p>
                <p className="mt-2">
                  <strong>Слабые стороны:</strong> {evaluation.weaknesses || '—'}
                </p>
                <p className="mt-2">
                  <strong>Рекомендации по развитию:</strong> {evaluation.development || '—'}
                </p>
                <p className="mt-2">
                  <strong>Итоговая рекомендация:</strong> {evaluation.recommendation || '—'}
                </p>
              </div>
            )}
            <div ref={historyEndRef} />
          </div>
        </section>

        <footer className="mt-6 text-xs text-[#a09c92]">
          Runtime: Autoro/Swoop · STT Whisper · LLM chat/completions · TTS speech · ключ только в
          браузере (localStorage)
        </footer>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="vr-settings-title"
        className="w-[min(100%,28rem)] rounded-lg border border-[#e6e5e0] bg-white p-0 shadow-none backdrop:bg-black/40"
        onClose={() => setSettingsOpen(false)}
        onClick={(e) => {
          const dlg = dialogRef.current
          if (!dlg) return
          const rect = dlg.getBoundingClientRect()
          const outside =
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          if (outside) dlg.close()
        }}
      >
        <form
          method="dialog"
          className="p-5"
          onSubmit={(e) => {
            e.preventDefault()
            saveApiKey()
          }}
        >
          <h2 id="vr-settings-title" className="text-lg font-medium">
            Настройки
          </h2>
          <p className="mt-2 text-sm text-[#5a5852]">
            Вставьте API-ключ Swoop (`agent_api_key` из Admin → Settings). Он используется для LLM,
            STT и TTS.
          </p>
          <label className="mt-4 block">
            <span className="mb-1 block text-sm text-[#807d72]">API-ключ</span>
            <input
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              className="w-full rounded-md border border-[#cfcdc4] px-3 py-2 outline-none focus:border-[#f54e00]"
              placeholder="X-API-Key"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-md border border-[#cfcdc4] px-3 py-2 text-sm"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="rounded-md bg-[#f54e00] px-3 py-2 text-sm text-white hover:bg-[#d04200]"
            >
              Сохранить
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
