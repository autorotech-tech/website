import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FileText, Trash2, Play, Loader2, CheckCircle } from 'lucide-react'

interface Document {
  id: string
  filename: string
  status: string
  created_at: string
}

export function FileList() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState<string | null>(null)

  useEffect(() => {
    fetchDocuments()
  }, [])

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (!error && data) setDocuments(data)
    setLoading(false)
  }

  const handleDelete = async (id: string, path: string) => { // Исправлено: path вместо filename
    // 1. Delete from Storage
    // Нам нужен полный путь файла, который мы сохранили как file_path
    // Но таблица хранит его как file_path
    const { error: storageError } = await supabase.storage
      .from('user_uploads')
      .remove([path])

    if (storageError) {
      console.error('Storage delete error:', storageError)
      return
    }

    // 2. Delete from DB
    const { error: dbError } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)

    if (!dbError) {
      setDocuments(prev => prev.filter(doc => doc.id !== id))
    }
  }

  const handleAnalyse = async (id: string) => {
    setAnalyzing(id)
    // Здесь будет вызов n8n webhook
    // Пока просто имитируем задержку и обновление статуса
    try {
        // Пример вызова webhook (нужно будет настроить CORS в n8n или прокси)
        // await fetch('https://tech.autoro.tech/webhook/analyse', {
        //   method: 'POST',
        //   body: JSON.stringify({ document_id: id })
        // })

        await new Promise(resolve => setTimeout(resolve, 2000))
        
        await supabase
          .from('documents')
          .update({ status: 'analyzed' })
          .eq('id', id)
        
        setDocuments(prev => prev.map(doc => 
          doc.id === id ? { ...doc, status: 'analyzed' } : doc
        ))
    } catch (e) {
        console.error(e)
    } finally {
        setAnalyzing(null)
    }
  }

  if (loading) return <div className="text-center py-4">Loading files...</div>

  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold mb-4">Your Documents</h3>
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <FileText className="text-gray-400 mr-2" size={16} />
                    <span className="text-sm font-medium text-gray-900">{doc.filename}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    doc.status === 'analyzed' ? 'bg-green-100 text-green-800' : 
                    doc.status === 'processing' ? 'bg-yellow-100 text-yellow-800' : 
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {doc.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(doc.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end gap-3">
                    {doc.status !== 'analyzed' && (
                        <button 
                            onClick={() => handleAnalyse(doc.id)}
                            disabled={analyzing === doc.id}
                            className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                        >
                            {analyzing === doc.id ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
                            Analyse
                        </button>
                    )}
                    {doc.status === 'analyzed' && (
                        <span className="text-green-600 flex items-center gap-1 cursor-default">
                            <CheckCircle size={16} /> Done
                        </span>
                    )}
                    <button 
                        onClick={() => handleDelete(doc.id, (doc as any).file_path)} 
                        className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
                <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                        No documents found. Upload some files to get started.
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

