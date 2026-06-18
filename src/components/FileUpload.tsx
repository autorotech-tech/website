import { useState, useCallback } from 'react'
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_FILES = 10
const ALLOWED_TYPES = [
  'application/pdf',
  'application/json',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]

interface FileUploadProps {
  taskId: string
  existingFilesCount: number
  existingFiles: string[]
  onUploadComplete: () => void
  disabled?: boolean
}

export function FileUpload({ taskId, existingFilesCount, existingFiles, onUploadComplete, disabled }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{ [key: string]: 'pending' | 'success' | 'error' }>({})
  const [progress, setProgress] = useState(0)

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault()
    setIsDragging(true)
  }, [disabled])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(validateFile)
    setFiles(prev => [...prev, ...droppedFiles])
  }, [disabled, existingFiles, existingFilesCount, files])

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(validateFile)
      setFiles(prev => [...prev, ...selectedFiles])
    }
  }, [disabled, existingFiles, existingFilesCount, files])

  const validateFile = (file: File) => {
    if (existingFilesCount + files.length >= MAX_FILES) {
      alert(`Limit reached: Maximum ${MAX_FILES} files per task.`)
      return false
    }
    if (existingFiles.includes(file.name) || files.some(f => f.name === file.name)) {
        alert(`File "${file.name}" already exists or is selected.`)
        return false
    }
    if (file.size > MAX_SIZE) {
      alert(`File ${file.name} is too large (max 10MB)`)
      return false
    }
    const isCsv = file.name.toLowerCase().endsWith('.csv')
    if (!ALLOWED_TYPES.includes(file.type) && !isCsv) {
      alert(`File ${file.name} has unsupported type`)
      return false
    }
    return true
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (existingFilesCount + files.length > MAX_FILES) {
        alert(`Cannot upload. Limit is ${MAX_FILES} files.`)
        return
    }

    setUploading(true)
    setProgress(0)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    let completed = 0
    
    for (const file of files) {
      try {
        const filePath = `${user.id}/${taskId}/${Date.now()}_${file.name}`
        
        const { error: uploadError } = await supabase.storage
          .from('user_uploads')
          .upload(filePath, file)

        if (uploadError) throw uploadError

        const { error: dbError } = await supabase
          .from('documents')
          .insert({
            user_id: user.id,
            task_id: taskId,
            filename: file.name,
            file_path: filePath,
            file_type: file.type,
            file_size: file.size,
            status: 'uploaded'
          })

        if (dbError) throw dbError

        setUploadStatus(prev => ({ ...prev, [file.name]: 'success' }))
      } catch (error) {
        console.error('Upload failed:', error)
        setUploadStatus(prev => ({ ...prev, [file.name]: 'error' }))
      } finally {
          completed++
          setProgress((completed / files.length) * 100)
      }
    }
    
    setTimeout(() => {
        setUploading(false)
        setFiles([]) 
        setUploadStatus({})
        setProgress(0)
        onUploadComplete()
    }, 500)
  }

  if (disabled) return null

  return (
    <div className="w-full bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">Add Files</h3>
      
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <p className="text-gray-600 mb-2">Drag & drop files here</p>
        <p className="text-xs text-gray-500 mb-4">Limit: 10 files per task. Max 10MB each.</p>
        <input
          type="file"
          multiple
          onChange={onFileSelect}
          className="hidden"
          id="file-upload"
          accept=".pdf,.docx,.csv,.json"
          disabled={uploading}
        />
        <label
          htmlFor="file-upload"
          className={`px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Select Files
        </label>
      </div>

      {files.length > 0 && (
        <div className="mt-6 space-y-3">
          {files.map((file, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200">
              <div className="flex items-center gap-3">
                <FileText className="text-blue-500" size={20} />
                <div>
                  <p className="text-sm font-medium truncate max-w-[200px]">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {uploadStatus[file.name] === 'success' && <CheckCircle className="text-green-500" size={20} />}
                {uploadStatus[file.name] === 'error' && <AlertCircle className="text-red-500" size={20} />}
                {!uploadStatus[file.name] && !uploading && (
                  <button onClick={() => removeFile(index)} className="text-gray-400 hover:text-red-500">
                    <X size={20} />
                  </button>
                )}
              </div>
            </div>
          ))}
          
          {uploading && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 mt-2">
                  <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
          )}

          <button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center justify-center gap-2 mt-4"
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Uploading {Math.round(progress)}%
              </>
            ) : (
              'Upload Selected Files'
            )}
          </button>
        </div>
      )}
    </div>
  )
}
