import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatBytes } from '../lib/format'
import { Trash2, User, ShieldCheck, DatabaseZap, Download, X, FileText, Loader2, Upload, Link as LinkIcon } from 'lucide-react'

interface Profile {
  id: string
  email: string
  role: string
  is_blocked: boolean
  created_at: string
}

interface AdminTask {
  id: string
  user_id: string
  status: string
  created_at: string
  instructions: string
  rag_status: string
  document_count?: number
  data_source?: string | null
  analysis_status?: string | null
  llm_provider?: string | null
  cleaned_data_path?: string | null
  analysis_result?: string | null
  tokens_input?: number | null
  tokens_output?: number | null
  llm_model?: string | null
}

interface AdminDocument {
    id: string
    task_id: string
    filename: string
    file_size: number
    file_path: string
    virus_status: string
    category?: string
    file_type?: string
}

interface SystemPrompt {
  id: string
  data_source: string
  prompt: string
}

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<'users' | 'tasks' | 'prompts'>('tasks')
  const [users, setUsers] = useState<Profile[]>([])
  const [tasks, setTasks] = useState<AdminTask[]>([])
  const [documents, setDocuments] = useState<AdminDocument[]>([])
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([])
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const [promptText, setPromptText] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [uploadingResult, setUploadingResult] = useState(false)

  useEffect(() => {
    checkAdmin()
  }, [])

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (data?.role === 'admin') {
      setIsAdmin(true)
      fetchData()
    } else {
      setLoading(false)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    // Fetch Users
    const { data: usersData } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
    
    if (usersData) setUsers(usersData)

    // Fetch Tasks
    const { data: tasksData } = await supabase
        .from('tasks')
        .select('id, user_id, status, created_at, instructions, admin_prompt, rag_status, data_source, analysis_status, llm_provider, cleaned_data_path, analysis_result, tokens_input, tokens_output, llm_model')
        .order('created_at', { ascending: false })
    
    if (tasksData) setTasks(tasksData)

    // Fetch Documents
    const { data: docsData } = await supabase
        .from('documents')
        .select('id, task_id, filename, file_size, file_path, file_type, virus_status, category')
    
    if (docsData) setDocuments(docsData)

    // Fetch System Prompts
    const { data: promptsData } = await supabase
        .from('system_prompts')
        .select('*')
        .order('data_source')
    
    if (promptsData) setSystemPrompts(promptsData)

    setLoading(false)
  }

  const saveSystemPrompt = async (id: string, newPrompt: string) => {
    setActionLoading(`prompt-${id}`)
    try {
      const { error } = await supabase
        .from('system_prompts')
        .update({ prompt: newPrompt, updated_at: new Date().toISOString() })
        .eq('id', id)
      
      if (error) throw error
      
      setSystemPrompts(prev => prev.map(p => p.id === id ? { ...p, prompt: newPrompt } : p))
      setEditingPrompt(null)
      alert('System prompt saved successfully')
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  // Periodic refresh for real-time progress
  useEffect(() => {
    if (!isAdmin || activeTab !== 'tasks') return

    const interval = setInterval(async () => {
      try {
        const { data: tasksData } = await supabase
          .from('tasks')
          .select('id, user_id, status, created_at, instructions, admin_prompt, rag_status, data_source, analysis_status, llm_provider, cleaned_data_path, analysis_result, tokens_input, tokens_output, llm_model')
          .order('created_at', { ascending: false })

        // Merge new data but preserve locally edited fields (admin_prompt, llm_provider)
        if (tasksData) {
          setTasks(prev => tasksData.map(newTask => {
            const existing = prev.find(t => t.id === newTask.id)
            if (existing) {
              return {
                ...newTask,
                admin_prompt: (existing as any).admin_prompt ?? (newTask as any).admin_prompt,
                llm_provider: existing.llm_provider ?? newTask.llm_provider,
              }
            }
            return newTask
          }))
        }

        const { data: docsData } = await supabase
          .from('documents')
          .select('id, task_id, filename, file_size, file_path, file_type, virus_status, category')

        if (docsData) setDocuments(docsData)
      } catch (e) {
        console.error('Periodic refresh error:', e)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [isAdmin, activeTab])

  const toggleBlockUser = async (userId: string, currentStatus: boolean) => {
      if (!window.confirm(`Are you sure you want to ${currentStatus ? 'unblock' : 'block'} this user?`)) return

      const { error } = await supabase
          .from('profiles')
          .update({ is_blocked: !currentStatus })
          .eq('id', userId)
      
      if (!error) {
          setUsers(users.map(u => u.id === userId ? { ...u, is_blocked: !currentStatus } : u))
      }
  }

  const deleteTask = async (taskId: string) => {
      if (!window.confirm('Delete this task? All associated files will be deleted.')) return

      const taskDocs = documents.filter(d => d.task_id === taskId)
      for (const doc of taskDocs) {
          // Only delete from storage if it's not a URL
          if (doc.file_type !== 'url') {
            const { error } = await supabase.storage.from('user_uploads').remove([doc.file_path])
            if (error) console.error('Storage delete error:', error)
          }
      }

      const { error } = await supabase.from('tasks').delete().eq('id', taskId)
      if (!error) {
          setTasks(tasks.filter(t => t.id !== taskId))
          setDocuments(documents.filter(d => d.task_id !== taskId))
          if (expandedTaskId === taskId) setExpandedTaskId(null)
      }
  }


  const downloadFile = async (doc: AdminDocument) => {
      if (doc.file_type === 'url') {
          window.open(doc.file_path, '_blank')
          return
      }

      // Handle inline analysis result
      if (doc.file_path.startsWith('inline:')) {
          const task = tasks.find(t => t.id === doc.task_id)
          if (task?.analysis_result) {
            const blob = new Blob([task.analysis_result], { type: 'text/markdown' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = doc.filename
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
          }
          return
      }

      const { data, error } = await supabase.storage.from('user_uploads').createSignedUrl(doc.file_path, 60)
      if (error || !data) {
          alert('Error creating download link')
          return
      }
      
      const link = document.createElement('a')
      link.href = data.signedUrl
      link.download = doc.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
  }

  const handleAddUrl = async (taskId: string) => {
    const url = prompt('Enter the URL:')
    if (!url) return

    try {
        new URL(url)
    } catch (e) {
        alert('Invalid URL')
        return
    }

    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const { data: docData, error } = await supabase
        .from('documents')
        .insert({
            user_id: task.user_id,
            task_id: taskId,
            filename: url,
            file_path: url,
            file_type: 'url',
            file_size: 0,
            status: 'uploaded',
            category: 'result'
        })
        .select('id, task_id, filename, file_size, file_path, file_type, virus_status, category')
        .single()

    if (error) {
        console.error('Error adding URL:', error)
        alert('Failed to add URL')
    } else if (docData) {
        setDocuments(prev => [...prev, docData])
    }
  }

  const handleResultUpload = async (taskId: string, files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingResult(true)

    try {
        const file = files[0]
        const task = tasks.find(t => t.id === taskId)
        if (!task) throw new Error('Task not found')

        const filePath = `${task.user_id}/${taskId}/results/${file.name}`
        
        const { error: uploadError } = await supabase.storage
            .from('user_uploads')
            .upload(filePath, file, { upsert: true })

        if (uploadError) throw uploadError

        const { data: docData, error: dbError } = await supabase
            .from('documents')
            .insert({
                user_id: task.user_id,
                task_id: taskId,
                filename: file.name,
                file_path: filePath,
                file_type: file.type,
                file_size: file.size,
                status: 'uploaded',
                category: 'result'
            })
            .select('id, task_id, filename, file_size, file_path, file_type, virus_status, category')
            .single()

        if (dbError) throw dbError

        if (docData) {
            setDocuments(prev => [...prev, docData])
        }

        alert('Result file uploaded successfully')

    } catch (error: any) {
        console.error('Upload result failed:', error)
        alert(`Failed to upload result file: ${error.message || error.error_description || JSON.stringify(error)}`)
    } finally {
        setUploadingResult(false)
    }
  }

  const scanVirus = async (taskId: string) => {
      setActionLoading(`scan-${taskId}`)
      try {
          console.log(`Triggering virus scan for task ${taskId}`)
          await new Promise(resolve => setTimeout(resolve, 1000)) 
          setDocuments(docs => docs.map(d => d.task_id === taskId ? { ...d, virus_status: 'clean' } : d))
          alert('Virus scan triggered (Simulated)')
      } catch (e) {
          console.error(e)
      } finally {
          setActionLoading(null)
      }
  }

  const getAnalysisProgress = (status?: string | null) => {
    const s = (status || 'pending').toLowerCase()
    if (s === 'cleaning') return { label: 'Cleaning…', value: 25, color: 'bg-amber-500' }
    if (s === 'cleaned') return { label: 'Cleaned', value: 40, color: 'bg-emerald-500' }
    if (s === 'queued') return { label: 'Queued', value: 55, color: 'bg-sky-500' }
    if (s === 'running') return { label: 'Running…', value: 80, color: 'bg-blue-600' }
    if (s === 'done') return { label: 'Done', value: 100, color: 'bg-green-600' }
    if (s === 'error') return { label: 'Error', value: 100, color: 'bg-red-600' }
    return { label: 'Pending', value: 5, color: 'bg-gray-400' }
  }

  const processClean = async (taskId: string) => {
      setActionLoading(`clean-${taskId}`)
      try {
        const task = tasks.find(t => t.id === taskId)
        if (!task) throw new Error('Task not found')

        const { error: updErr } = await supabase
          .from('tasks')
          .update({ analysis_status: 'cleaning' })
          .eq('id', taskId)
        if (updErr) throw updErr

        const { error: jobErr } = await supabase
          .from('marketing_audit_jobs')
          .insert({ task_id: taskId, user_id: task.user_id, stage: 'cleaning', status: 'queued' })
        if (jobErr) throw jobErr

        setTasks(ts => ts.map(t => t.id === taskId ? { ...t, analysis_status: 'cleaning' } : t))
        alert('Data preparation queued (cleaning)')
      } catch (e: any) {
        console.error(e)
        alert(`Failed to queue data preparation: ${e.message || 'unknown error'}`)
      } finally {
        setActionLoading(null)
      }
  }

  const processAudit = async (taskId: string, llmCsv: string) => {
      setActionLoading(`audit-${taskId}`)
      try {
        const task = tasks.find(t => t.id === taskId)
        if (!task) throw new Error('Task not found')

        const { error: updErr } = await supabase
          .from('tasks')
          .update({ llm_provider: llmCsv, analysis_status: 'queued' })
          .eq('id', taskId)
        if (updErr) throw updErr

        const { error: jobErr } = await supabase
          .from('marketing_audit_jobs')
          .insert({ task_id: taskId, user_id: task.user_id, stage: 'full', status: 'queued' })
        if (jobErr) throw jobErr

        setTasks(ts => ts.map(t => t.id === taskId ? { ...t, llm_provider: llmCsv, analysis_status: 'queued' } : t))
        alert('Analysis task queued successfully')
      } catch (e: any) {
        console.error(e)
        alert(`Failed to queue: ${e.message || 'unknown error'}`)
      } finally {
        setActionLoading(null)
      }
  }

  if (loading) return <div className="p-8 text-center">Loading data...</div>
  if (!isAdmin) return <div className="p-8 text-center text-red-600">Access Denied</div>

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
        <div className="flex space-x-2 bg-white p-1 rounded-md border border-gray-200">
            <button 
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'users' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                Users
            </button>
            <button 
                onClick={() => setActiveTab('tasks')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'tasks' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                All Tasks
            </button>
            <button 
                onClick={() => setActiveTab('prompts')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'prompts' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                System Prompts
            </button>
        </div>
      </div>

      {activeTab === 'users' && (
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                      <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                      {users.map(user => (
                          <tr key={user.id}>
                              <td className="px-6 py-4">
                                  <div className="flex items-center">
                                      <div className="flex-shrink-0 h-10 w-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                                          <User size={20} />
                                      </div>
                                      <div className="ml-4">
                                          <div className="text-sm font-medium text-gray-900">{user.email}</div>
                                          <div className="text-sm text-gray-500">ID: {user.id.slice(0, 8)}...</div>
                                      </div>
                                  </div>
                              </td>
                              <td className="px-6 py-4">
                                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                                  }`}>
                                      {user.role}
                                  </span>
                              </td>
                              <td className="px-6 py-4">
                                  {user.is_blocked ? (
                                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                                          Blocked
                                      </span>
                                  ) : (
                                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                          Active
                                      </span>
                                  )}
                              </td>
                              <td className="px-6 py-4 text-right text-sm font-medium">
                                  {user.email !== 'tech@autoro.tech' && ( 
                                      <button
                                          onClick={() => toggleBlockUser(user.id, user.is_blocked)}
                                          className={`text-sm ${user.is_blocked ? 'text-green-600 hover:text-green-900' : 'text-red-600 hover:text-red-900'}`}
                                      >
                                          {user.is_blocked ? 'Unblock' : 'Block'}
                                      </button>
                                  )}
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      )}

      {activeTab === 'tasks' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                      <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Task ID</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Files</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                      {tasks.map(task => {
                          const user = users.find(u => u.id === task.user_id)
                          const taskDocs = documents.filter(d => d.task_id === task.id)
                          const isExpanded = expandedTaskId === task.id

                          return (
                              <tr key={task.id} className={`${isExpanded ? 'bg-blue-50' : ''} cursor-pointer hover:bg-gray-50`} onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                      #{task.id.slice(0, 8)}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      {user ? user.email : task.user_id.slice(0, 8)}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      {taskDocs.length} files
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex flex-col gap-1">
                                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${
                                        task.status === 'completed' ? 'bg-green-100 text-green-800' :
                                        task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-800'
                                      }`}>
                                        {task.status}
                                      </span>
                                      {(() => {
                                        const { label, value, color } = getAnalysisProgress(task.analysis_status)
                                        return (
                                          <div className="flex flex-col gap-0.5">
                                            <span className="text-[11px] text-blue-700 font-medium">
                                              Analysis: {label}
                                            </span>
                                            <div className="w-32 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                              <div
                                                className={`h-full ${color} transition-all`}
                                                style={{ width: `${value}%` }}
                                              />
                                            </div>
                                          </div>
                                        )
                                      })()}
                                      {task.rag_status !== 'pending' && (
                                        <span className="text-xs text-purple-600 font-medium">RAG: {task.rag_status}</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-right text-sm font-medium">
                                      <div className="flex items-center justify-end gap-2">
                                          <button
                                              onClick={() => scanVirus(task.id)}
                                              disabled={!!actionLoading}
                                              className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                                              title="Scan for Virus"
                                          >
                                              {actionLoading === `scan-${task.id}` ? <Loader2 className="animate-spin" size={18}/> : <ShieldCheck size={18} />}
                                          </button>
                                          <button
                                              onClick={() => processClean(task.id)}
                                              disabled={!!actionLoading}
                                              className="p-1 text-gray-500 hover:text-amber-600 transition-colors"
                                              title="Prepare data (cleaning)"
                                          >
                                              {actionLoading === `clean-${task.id}` ? <Loader2 className="animate-spin" size={18}/> : <DatabaseZap size={18} />}
                                          </button>
                                          <button
                                              onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                                              className={`p-1 transition-colors ${isExpanded ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
                                              title="View / Analyse"
                                          >
                                              <FileText size={18} />
                                          </button>
                                          <button
                                              onClick={() => deleteTask(task.id)}
                                              className="p-1 text-red-400 hover:text-red-600 transition-colors"
                                              title="Delete Task"
                                          >
                                              <Trash2 size={18} />
                                          </button>
                                      </div>
                                  </td>
                              </tr>
                          )
                      })}
                  </tbody>
              </table>
            </div>

            {expandedTaskId && (
                <div className="bg-gray-50 p-4 rounded-lg border border-blue-200">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                            <FileText size={18} />
                            Task Details #{expandedTaskId.slice(0,8)}
                        </h3>
                        <button onClick={() => setExpandedTaskId(null)} className="text-gray-400 hover:text-gray-600">
                            <X size={20} />
                        </button>
                    </div>

                    {/* Data Source (readonly) */}
                    {tasks.find(t => t.id === expandedTaskId)?.data_source && (
                      <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <label className="block text-sm font-medium text-gray-600 mb-2">Data Source</label>
                        <div className="p-2 text-sm bg-white border border-gray-200 rounded-md text-gray-700">
                          {tasks.find(t => t.id === expandedTaskId)?.data_source?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </div>
                      </div>
                    )}

                    {/* User Instructions (readonly) */}
                    {tasks.find(t => t.id === expandedTaskId)?.instructions && (
                      <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <label className="block text-sm font-medium text-gray-600 mb-2">User Instructions</label>
                        <div className="p-2 text-sm bg-white border border-gray-200 rounded-md text-gray-700 whitespace-pre-wrap">
                          {tasks.find(t => t.id === expandedTaskId)?.instructions}
                        </div>
                      </div>
                    )}

                    {/* Admin Prompt */}
                    <div className="mb-4 bg-white border border-gray-200 rounded-lg p-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Admin Prompt (additional)</label>
                      <textarea
                        value={(tasks.find(t => t.id === expandedTaskId) as any)?.admin_prompt || ''}
                        onChange={async (e) => {
                          const val = e.target.value.slice(0, 2000)
                          setTasks(ts => ts.map(t => t.id === expandedTaskId ? { ...t, admin_prompt: val } as any : t))
                        }}
                        onBlur={async (e) => {
                          if (expandedTaskId) {
                            await supabase.from('tasks').update({ admin_prompt: e.target.value }).eq('id', expandedTaskId)
                          }
                        }}
                        className="w-full h-24 p-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter admin instructions to add to user prompt..."
                      />
                      <p className="text-xs text-gray-500 mt-1">Combined: System Prompt + Admin Prompt + User Instructions + Data</p>
                    </div>

                    {/* Audit controls */}
                    <div className="mb-4 bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap gap-3 items-center justify-between">
                      <div className="space-y-1">
                        <div className="text-sm text-gray-700 font-medium">Marketing Audit</div>
                        <div className="text-xs text-gray-500">Select LLMs for analysis (multiple allowed).</div>
                        {(() => {
                          const t = tasks.find(tt => tt.id === expandedTaskId)
                          if (!t) return null
                          const { label, value, color } = getAnalysisProgress(t.analysis_status)
                          return (
                            <div className="mt-1 space-y-1">
                              <div className="text-[11px] text-blue-700 font-medium">
                                Analysis status: {label} ({t.analysis_status || 'pending'})
                              </div>
                              <div className="w-40 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className={`h-full ${color} transition-all`}
                                  style={{ width: `${value}%` }}
                                />
                              </div>
                              {(t.tokens_input || t.tokens_output) && (
                                <div className="text-[11px] text-gray-600 mt-1">
                                  Tokens: {t.tokens_input?.toLocaleString() || 0} in / {t.tokens_output?.toLocaleString() || 0} out
                                  {t.llm_model && <span className="ml-2 text-gray-400">({t.llm_model})</span>}
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        {(() => {
                          const t = tasks.find(tt => tt.id === expandedTaskId)
                          const raw = (t?.llm_provider || '') as string
                          const selected = new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
                          const toggle = async (key: string) => {
                            const next = new Set(selected)
                            if (next.has(key)) {
                              next.delete(key)
                            } else {
                              next.add(key)
                            }
                            const csv = Array.from(next).join(',') || ''
                            setTasks(ts => ts.map(x => x.id === expandedTaskId ? { ...x, llm_provider: csv } : x))
                            // Save to DB immediately
                            if (expandedTaskId) {
                              await supabase.from('tasks').update({ llm_provider: csv }).eq('id', expandedTaskId)
                            }
                          }
                          return (
                            <>
                              <div className="flex flex-wrap gap-3 text-sm text-gray-700">
                                <label className="inline-flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    checked={selected.has('gemini')}
                                    onChange={() => toggle('gemini')}
                                  />
                                  <span>Gemini</span>
                                </label>
                                <label className="inline-flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    checked={selected.has('glm')}
                                    onChange={() => toggle('glm')}
                                  />
                                  <span>GLM (Bigmodel)</span>
                                </label>
                              </div>
                              <button
                                onClick={() => {
                                  const tt = tasks.find(xx => xx.id === expandedTaskId)
                                  const csv = (tt?.llm_provider || '') as string
                                  if (!tt) return
                                  const providers = csv.split(',').map(s => s.trim()).filter(Boolean)
                                  if (!providers.length) {
                                    alert('Select at least one LLM (Gemini/GLM)')
                                    return
                                  }
                                  processAudit(tt.id, csv)
                                }}
                                disabled={!!actionLoading}
                                className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-60 whitespace-nowrap"
                              >
                                Queue Analyse
                              </button>
                              <button
                                onClick={() => expandedTaskId && processClean(expandedTaskId)}
                                disabled={!!actionLoading}
                                className="px-3 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600 text-sm disabled:opacity-60 whitespace-nowrap"
                                title="Prepare data (cleaning)"
                              >
                                Prepare Data
                              </button>
                            </>
                          )
                        })()}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* User Files */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-500 mb-2">User Uploads</h4>
                            <div className="space-y-2">
                                {documents.filter(d => d.task_id === expandedTaskId && d.category !== 'result').map(doc => (
                                    <div key={doc.id} className="flex items-center justify-between bg-white p-3 rounded border border-gray-200">
                                        <div className="flex items-center gap-3">
                                            <span className={`w-2 h-2 rounded-full ${
                                                doc.virus_status === 'clean' ? 'bg-green-500' : 
                                                doc.virus_status === 'infected' ? 'bg-red-500' : 'bg-gray-300'
                                            }`} title={`Virus Status: ${doc.virus_status}`} />
                                            <div>
                                                <div className="text-sm font-medium text-gray-900 truncate max-w-[150px]">{doc.filename}</div>
                                                <div className="text-xs text-gray-500">{formatBytes(doc.file_size)}</div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => downloadFile(doc)}
                                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded transition-colors"
                                        >
                                            <Download size={14} />
                                        </button>
                                    </div>
                                ))}
                                {documents.filter(d => d.task_id === expandedTaskId && d.category !== 'result').length === 0 && (
                                    <p className="text-sm text-gray-400 italic">No files.</p>
                                )}
                            </div>
                        </div>


                        {/* Result Files */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-500 mb-2 flex justify-between items-center">
                                <span>Results / Admin Uploads</span>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => handleAddUrl(expandedTaskId)}
                                        className="text-xs bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 transition-colors flex items-center gap-1"
                                    >
                                        <LinkIcon size={12} />
                                        Add URL
                                    </button>
                                    <label className="cursor-pointer text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors flex items-center gap-1">
                                        {uploadingResult ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12} />}
                                        Upload Result
                                        <input 
                                            type="file" 
                                            accept=".pdf,.docx,.csv,.txt"
                                            className="hidden" 
                                            disabled={uploadingResult}
                                            onChange={(e) => handleResultUpload(expandedTaskId, e.target.files)}
                                        />
                                    </label>
                                </div>
                            </h4>
                            <div className="space-y-2">
                                {documents.filter(d => d.task_id === expandedTaskId && d.category === 'result').map(doc => (
                                    <div key={doc.id} className="flex items-center justify-between bg-blue-50 p-3 rounded border border-blue-100">
                                        <div className="flex items-center gap-3">
                                            {doc.file_type === 'url' ? <LinkIcon size={16} className="text-purple-500" /> : <FileText size={16} className="text-blue-500" />}
                                            <div>
                                                <div className="text-sm font-medium text-gray-900 truncate max-w-[150px]">{doc.filename}</div>
                                                <div className="text-xs text-gray-500">{doc.file_type === 'url' ? 'Link' : formatBytes(doc.file_size)}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => downloadFile(doc)}
                                                className="text-xs bg-white hover:bg-gray-100 text-gray-700 px-2 py-1 rounded transition-colors border border-gray-200"
                                            >
                                                {doc.file_type === 'url' ? <LinkIcon size={14} /> : <Download size={14} />}
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    if(!window.confirm('Delete result?')) return;
                                                    if (doc.file_type !== 'url') {
                                                        await supabase.storage.from('user_uploads').remove([doc.file_path]);
                                                    }
                                                    await supabase.from('documents').delete().eq('id', doc.id);
                                                    setDocuments(prev => prev.filter(d => d.id !== doc.id));
                                                }}
                                                className="text-xs text-red-400 hover:text-red-600 p-1"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {documents.filter(d => d.task_id === expandedTaskId && d.category === 'result').length === 0 && (
                                    <p className="text-sm text-gray-400 italic">No results uploaded yet.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
          </div>
      )}

      {activeTab === 'prompts' && (
          <div className="space-y-6">
              <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
                  <h2 className="text-lg font-semibold mb-4">System Prompts by Data Source</h2>
                  <p className="text-sm text-gray-500 mb-6">
                      Configure the system prompt sent to LLM for each data source type. 
                      The prompt defines how the AI analyzes the uploaded data.
                  </p>
                  
                  <div className="space-y-4">
                      {systemPrompts.map(sp => (
                          <div key={sp.id} className="border border-gray-200 rounded-lg p-4">
                              <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-3">
                                      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                                          {sp.data_source}
                                      </span>
                                  </div>
                                  {editingPrompt !== sp.id ? (
                                      <button
                                          onClick={() => {
                                              setEditingPrompt(sp.id)
                                              setPromptText(sp.prompt)
                                          }}
                                          className="text-sm text-blue-600 hover:text-blue-800"
                                      >
                                          Edit
                                      </button>
                                  ) : (
                                      <div className="flex gap-2">
                                          <button
                                              onClick={() => saveSystemPrompt(sp.id, promptText)}
                                              disabled={!!actionLoading}
                                              className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                                          >
                                              Save
                                          </button>
                                          <button
                                              onClick={() => setEditingPrompt(null)}
                                              className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                                          >
                                              Cancel
                                          </button>
                                      </div>
                                  )}
                              </div>
                              
                              {editingPrompt === sp.id ? (
                                  <textarea
                                      value={promptText}
                                      onChange={(e) => setPromptText(e.target.value)}
                                      className="w-full h-64 p-3 border border-gray-300 rounded-lg font-mono text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      placeholder="Enter system prompt..."
                                  />
                              ) : (
                                  <pre className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                      {sp.prompt}
                                  </pre>
                              )}
                          </div>
                      ))}
                      
                      {systemPrompts.length === 0 && (
                          <p className="text-gray-500 italic">No system prompts configured.</p>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  )
}
