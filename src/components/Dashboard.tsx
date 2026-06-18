import { FileUp, Database, Cpu } from 'lucide-react'
import { FileList } from './FileList'

export function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard Overview</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-full text-blue-600">
              <FileUp size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Upload Files</p>
              <h3 className="text-lg font-bold text-blue-600 hover:underline cursor-pointer" onClick={() => window.location.href='/upload'}>Go to Upload</h3>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-full text-green-600">
              <Database size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Knowledge Base</p>
              <h3 className="text-2xl font-bold">Active</h3>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-full text-purple-600">
              <Cpu size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Processing</p>
              <h3 className="text-2xl font-bold">Idle</h3>
            </div>
          </div>
        </div>
      </div>

      <FileList />
    </div>
  )
}
