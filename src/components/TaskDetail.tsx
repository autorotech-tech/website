import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { FileUpload } from './FileUpload'
import { formatBytes } from '../lib/format'
import { ArrowLeft, FileText, Trash2, Send, Loader2, Save, Download, Link as LinkIcon, BellRing } from 'lucide-react'

interface Task {
  id: string
  status: string
  rag_status: string
  instructions: string
  created_at: string
  task_type?: string
  data_source?: string | null
  analysis_prompt?: string | null
  analysis_status?: string | null
  llm_provider?: string | null
  analysis_result?: string | null
  tokens_input?: number | null
  tokens_output?: number | null
  llm_model?: string | null
}

interface Document {
  id: string
  filename: string
  file_size: number
  file_path: string
  category?: string
  file_type?: string
}

export function TaskDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [task, setTask] = useState<Task | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [instructions, setInstructions] = useState('')
  const [dataSource, setDataSource] = useState<string>('google_ads')
  const [analysisPrompt, setAnalysisPrompt] = useState<string>('')
  const [dataUrl, setDataUrl] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (id) fetchTaskData()
  }, [id])

  const fetchTaskData = async (updateFormFields = true) => {
    if (!id) return
    
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .single()
    
    if (taskError) {
      console.error('Error fetching task:', taskError)
      navigate('/')
      return
    }

    setTask(taskData)
    // Only update form fields on initial load, not after file uploads
    if (updateFormFields) {
      setInstructions(taskData.instructions || '')
      setDataSource(taskData.data_source || 'google_ads')
      setAnalysisPrompt(taskData.analysis_prompt || '')
    }

    const { data: docsData, error: docsError } = await supabase
      .from('documents')
      .select('*')
      .eq('task_id', id)
    
    if (!docsError && docsData) setDocuments(docsData)
    setLoading(false)
  }

  const handleSaveInstructions = async () => {
    if (!id) return
    setSaving(true)
    try {
        const { error: dbError } = await supabase
          .from('tasks')
          .update({ instructions, data_source: dataSource, analysis_prompt: analysisPrompt })
          .eq('id', id)
        
        if (dbError) throw dbError

        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
             const csvContent = `Instructions\n"${instructions.replace(/"/g, '""')}"`
             const csvFile = new File([csvContent], `${id}_instructions.csv`, { type: 'text/csv' })
             const filePath = `${user.id}/${id}/${id}_instructions.csv`
             
             const { error: uploadError } = await supabase.storage
                .from('user_uploads')
                .upload(filePath, csvFile, { upsert: true })
             
             if (uploadError) throw uploadError
        }
        
        if (task) setTask({ ...task, instructions })

    } catch (error) {
        console.error('Error saving instructions:', error)
        alert('Failed to save instructions')
    } finally {
        setSaving(false)
    }
  }

  const handleDeleteFile = async (docId: string, filePath: string) => {
    if (!id) return
    
    const { error: storageError } = await supabase.storage
      .from('user_uploads')
      .remove([filePath])

    if (storageError) console.error(storageError)

    const { error: dbError } = await supabase
      .from('documents')
      .delete()
      .eq('id', docId)

    if (!dbError) {
      setDocuments(prev => prev.filter(d => d.id !== docId))
    }
  }

  const downloadFile = async (doc: Document) => {
      if (doc.file_type === 'url') {
          window.open(doc.file_path, '_blank')
          return
      }

      // Handle inline analysis result
      if (doc.file_path.startsWith('inline:')) {
          if (!task?.id) return
          const { data: taskData } = await supabase
            .from('tasks')
            .select('analysis_result')
            .eq('id', task.id)
            .single()
          if (taskData?.analysis_result) {
            const blob = new Blob([taskData.analysis_result], { type: 'text/markdown' })
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

  const handleSend = async () => {
    if (!id || !task) return
    if (documents.length === 0) {
        alert('Please upload at least one file.')
        return
    }
    
    // instructions/analysisPrompt can be empty — allow sending
    
    setSending(true)
    
    // Save instructions (DB + CSV)
    await handleSaveInstructions()

    try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const instructionDoc = documents.find(d => d.filename === `${id}_instructions.csv`)
            
            if (!instructionDoc) {
                const csvContent = `Instructions\n"${instructions.replace(/"/g, '""')}"`
                const filePath = `${user.id}/${id}/${id}_instructions.csv`
                
                const { error: dbError } = await supabase
                    .from('documents')
                    .insert({
                        user_id: user.id,
                        task_id: id,
                        filename: `${id}_instructions.csv`,
                        file_path: filePath,
                        file_type: 'text/csv',
                        file_size: new Blob([csvContent]).size,
                        status: 'uploaded'
                    })
                if (dbError) console.error('Error inserting instruction doc record', dbError)
            }
        }

        const { error: taskUpdateError } = await supabase
        .from('tasks')
        .update({ status: 'in_progress', analysis_status: 'queued', data_source: dataSource, analysis_prompt: analysisPrompt })
        .eq('id', id)
        if (taskUpdateError) throw taskUpdateError

        if (user) {
          const { error: jobError } = await supabase
            .from('marketing_audit_jobs')
            .insert({
              task_id: id,
              user_id: user.id,
              stage: 'full',
              status: 'queued',
            })
          if (jobError) throw jobError
        }

        console.log('Triggering analysis for task:', id)
        
        setTask({ ...task, status: 'in_progress', analysis_status: 'queued', data_source: dataSource, analysis_prompt: analysisPrompt })
        fetchTaskData() 

    } catch (e) {
        console.error('Error sending task:', e)
        alert('Failed to send task. Please try again.')
    } finally {
        setSending(false)
    }
  }

  if (loading) return <div className="text-center py-8">Loading task...</div>
  if (!task) return <div className="text-center py-8">Task not found</div>

  const isDraft = task.status === 'draft'
  const canEditInstructions = task.rag_status !== 'processing' && task.rag_status !== 'ready'
  
  const userFiles = documents.filter(d => d.category !== 'result')
  const resultFiles = documents.filter(d => d.category === 'result')

  return (
    <div className="max-w-4xl mx-auto">
      <button 
        onClick={() => navigate('/')}
        className="flex items-center text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft size={20} className="mr-2" />
        Back to Tasks
      </button>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex justify-between items-start mb-6 gap-4 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3 flex-wrap">
              Task #{task.id.slice(0, 8)}
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                task.status === 'completed' ? 'bg-green-100 text-green-800' :
                task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {task.status === 'draft' ? 'Draft' : 
                 task.status === 'in_progress' ? 'In Progress' : 
                 task.status === 'completed' ? 'Completed' : task.status}
              </span>
              {resultFiles.length > 0 && (
                <span className="flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 border border-purple-200 animate-pulse">
                    <BellRing size={16} />
                    Results Ready
                </span>
              )}
            </h1>
            <p className="text-gray-500 text-sm">Created on {new Date(task.created_at).toLocaleDateString()}</p>
            <p className="text-gray-500 text-sm">Analysis status: {task.analysis_status || 'pending'}</p>
          </div>
          
          {isDraft && (
            <button
              onClick={handleSend}
              disabled={sending || userFiles.length === 0}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:bg-gray-300"
            >
              {sending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
              Send for Analysis
            </button>
          )}
        </div>

        <div className="mb-8 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data source</label>
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="google_ads">Google Ads</option>
                <option value="facebook_ads">Facebook Ads</option>
                <option value="instagram_ads">Instagram Ads</option>
                <option value="yandex_direct">Yandex Direct</option>
                <option value="tiktok_ads">TikTok Ads</option>
                <option value="google_analytics">Google Analytics</option>
                <option value="yandex_metrika">Yandex Metrika</option>
                <option value="raw">Raw Data</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Format: CSV/XLSX/PDF/DOC or Google Sheets link.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data URL (optional, max 3)</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={dataUrl}
                  onChange={(e) => setDataUrl(e.target.value.slice(0, 500))}
                  maxLength={500}
                  disabled={documents.filter(d => d.file_type === 'url' && d.category !== 'result').length >= 3}
                  className="flex-1 border rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  placeholder="https://docs.google.com/spreadsheets/..."
                />
                <button
                  type="button"
                  disabled={!dataUrl.trim() || documents.filter(d => d.file_type === 'url' && d.category !== 'result').length >= 3}
                  onClick={async () => {
                    if (!id || !dataUrl.trim()) return
                    const { data: { user } } = await supabase.auth.getUser()
                    if (!user) return
                    const { error } = await supabase.from('documents').insert({
                      task_id: id,
                      user_id: user.id,
                      filename: new URL(dataUrl).hostname,
                      file_path: dataUrl,
                      file_size: 0,
                      file_type: 'url',
                      virus_status: 'clean',
                      category: 'user_upload'
                    })
                    if (!error) {
                      setDataUrl('')
                      fetchTaskData(false)
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">{documents.filter(d => d.file_type === 'url' && d.category !== 'result').length}/3 URLs added</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Additional prompt for LLM (max 1000 chars)
            </label>
            <div className="relative">
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value.slice(0, 1000))}
                disabled={!canEditInstructions}
                className="w-full h-32 p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="Your niche, GEO, specific goals, or analysis requirements..."
              />
              <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                {instructions.length}/1000
              </div>
              {canEditInstructions && instructions !== task.instructions && (
                  <button 
                      onClick={handleSaveInstructions}
                      className="absolute top-2 right-2 p-1 text-gray-400 hover:text-blue-600"
                      title="Save Changes"
                  >
                      {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  </button>
              )}
            </div>
          </div>
        </div>

        {/* Results Section */}
        {(resultFiles.length > 0 || task.analysis_result) && (
            <div className="mb-8 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-200 shadow-sm">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-blue-800">
                    <FileText size={24} />
                    Analysis Results
                </h3>
                
                {/* Token usage info */}
                {(task.tokens_input || task.tokens_output) && (
                    <div className="mb-4 text-xs text-gray-500 flex gap-4">
                        {task.tokens_input && <span>Input tokens: {task.tokens_input.toLocaleString()}</span>}
                        {task.tokens_output && <span>Output tokens: {task.tokens_output.toLocaleString()}</span>}
                    </div>
                )}

                {/* Download button */}
                {task.analysis_result && (
                    <div className="mb-4">
                        <button
                            onClick={() => {
                                if (!task.analysis_result) return
                                const blob = new Blob([task.analysis_result], { type: 'text/markdown' })
                                const url = URL.createObjectURL(blob)
                                const link = document.createElement('a')
                                link.href = url
                                link.download = `analysis_${task.id.slice(0,8)}.md`
                                document.body.appendChild(link)
                                link.click()
                                document.body.removeChild(link)
                                URL.revokeObjectURL(url)
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                        >
                            <Download size={18} />
                            Download Analysis Report (.md)
                        </button>
                    </div>
                )}

                {/* Visual result display */}
                {task.analysis_result && (
                    <div className="bg-white rounded-lg border border-blue-200 p-4 max-h-[600px] overflow-y-auto shadow-inner">
                        <div className="prose prose-sm max-w-none prose-headings:text-blue-800 prose-strong:text-gray-800">
                            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                                {task.analysis_result}
                            </pre>
                        </div>
                    </div>
                )}

                {/* File downloads */}
                {resultFiles.length > 0 && (
                    <div className="mt-4 space-y-3">
                        {resultFiles.map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between p-3 bg-white rounded border border-blue-200 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-100 rounded text-blue-600">
                                        {doc.file_type === 'url' ? <LinkIcon size={20} /> : <FileText size={20} />}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 truncate max-w-[300px]">{doc.filename}</p>
                                        <p className="text-xs text-gray-500">{doc.file_type === 'url' ? 'Link' : formatBytes(doc.file_size)}</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => downloadFile(doc)}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                                >
                                    {doc.file_type === 'url' ? <LinkIcon size={16} /> : <Download size={16} />}
                                    {doc.file_type === 'url' ? 'Open' : 'Download'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}

        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center justify-between">
            Uploaded Files ({userFiles.length}/10)
          </h3>
          
          <div className="space-y-3">
            {userFiles.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200">
                <div className="flex items-center gap-3">
                  <FileText className="text-blue-500" size={20} />
                  <div>
                    <p className="text-sm font-medium text-gray-900 truncate max-w-[300px]">{doc.filename}</p>
                    <p className="text-xs text-gray-500">{formatBytes(doc.file_size)}</p>
                  </div>
                </div>
                {isDraft && (
                  <button 
                    onClick={() => handleDeleteFile(doc.id, doc.file_path)}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
            {userFiles.length === 0 && (
                <p className="text-gray-500 italic text-sm">No files uploaded yet.</p>
            )}
          </div>
        </div>

        {isDraft && (
            <FileUpload 
                taskId={task.id} 
                existingFilesCount={userFiles.length} 
                existingFiles={userFiles.map(d => d.filename)}
                onUploadComplete={() => fetchTaskData(false)}
                disabled={!isDraft}
            />
        )}
      </div>
    </div>
  )
}
