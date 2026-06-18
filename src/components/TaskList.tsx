import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Calendar, ChevronRight, Loader2, BellRing } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface Task {
  id: string
  status: string
  created_at: string
  instructions: string | null
  has_results?: boolean
}

export function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    const { data: tasksData, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (tasksError || !tasksData) {
        setLoading(false)
        return
    }

    const taskIds = tasksData.map(t => t.id)
    
    const { data: resultDocs } = await supabase
        .from('documents')
        .select('task_id')
        .in('task_id', taskIds)
        .eq('category', 'result')

    const tasksWithResults = tasksData.map(task => ({
        ...task,
        has_results: resultDocs?.some(d => d.task_id === task.id)
    }))

    setTasks(tasksWithResults)
    setLoading(false)
  }

  const handleCreateTask = async () => {
    setCreating(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        user_id: user.id,
        status: 'draft',
        instructions: ''
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating task:', error)
      alert('Failed to create task')
    } else if (data) {
      navigate(`/task/${data.id}`)
    }
    setCreating(false)
  }

  if (loading) return <div className="text-center py-8">Loading tasks...</div>

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
        <button
          onClick={handleCreateTask}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400"
        >
          {creating ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}
          Add Task
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        {tasks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No tasks found. Create your first task to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {tasks.map((task) => (
              <div 
                key={task.id} 
                onClick={() => navigate(`/task/${task.id}`)}
                className="p-6 hover:bg-gray-50 cursor-pointer transition-colors flex justify-between items-center"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-medium text-gray-900">Task #{task.id.slice(0, 8)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      task.status === 'completed' ? 'bg-green-100 text-green-800' :
                      task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {task.status === 'draft' ? 'Draft' : 
                       task.status === 'in_progress' ? 'In Progress' : 
                       task.status === 'completed' ? 'Completed' : task.status}
                    </span>
                    {task.has_results && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                            <BellRing size={12} />
                            Results Ready
                        </span>
                    )}
                  </div>
                  <div className="flex items-center text-sm text-gray-500 gap-2">
                    <Calendar size={14} />
                    {new Date(task.created_at).toLocaleDateString()} {new Date(task.created_at).toLocaleTimeString()}
                  </div>
                </div>
                <ChevronRight className="text-gray-400" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
