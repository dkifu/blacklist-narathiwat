import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import CenterTaskDetail from './CenterTaskDetail'

const CATEGORY_LABELS = {
  station: 'งานประจำ สภ.',
  south_project: 'โครงการงานใต้',
  phuket_project: 'โครงการงานภูเก็ต',
  pik: 'งานพี่ปิ๊ก',
  por: 'งานพี่ปอ',
  ood: 'งานพี่อู๊ด',
  other: 'งานอื่น ๆ',
}

const PRIORITY_LABELS = {
  normal: 'ปกติ',
  urgent: 'เร่งด่วน',
  critical: 'ด่วนมาก',
}

const STATUS_LABELS = {
  pending: 'รอดำเนินการ',
  doing: 'กำลังดำเนินการ',
  completed: 'เสร็จแล้ว',
}

function CenterTasks({ profile }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const [selectedTaskId, setSelectedTaskId] = useState(null)

  useEffect(() => {
    loadTasks()
  }, [profile?.center_id])

  const loadTasks = async () => {
    if (!profile?.center_id) {
      setTasks([])
      setLoading(false)
      setMessage('บัญชีนี้ยังไม่ได้ผูกกับศูนย์')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const {
        data: assignedRows,
        error: assignedError,
      } = await supabase
        .from('admin_task_centers')
        .select('task_id, center_id, status')
        .eq(
          'center_id',
          Number(profile.center_id)
        )

      console.log(
        'CENTER DEBUG',
        {
            profile,
            centerId: profile?.center_id,
            assignedRows,
            assignedError,
        }
        )

        
      if (assignedError) {
        throw assignedError
      }

      const assignments = assignedRows || []

      const taskIds = [
        ...new Set(
          assignments.map(
            (item) => item.task_id
          )
        ),
      ]

      if (taskIds.length === 0) {
        setTasks([])
        setLoading(false)
        return
      }

      const {
        data: taskRows,
        error: taskError,
      } = await supabase
        .from('admin_tasks')
        .select(
          `
            id,
            category,
            priority,
            title,
            description,
            note,
            status,
            created_at
          `
        )
        .in('id', taskIds)
        .neq('status', 'archived')
        .order('created_at', {
          ascending: false,
        })

      if (taskError) {
        throw taskError
      }

      const statusMap = {}

      assignments.forEach((item) => {
        statusMap[String(item.task_id)] =
          item.status
      })

      const rows = (taskRows || []).map(
        (task) => ({
          ...task,

          center_status:
            statusMap[String(task.id)] ||
            'pending',
        })
      )

      setTasks(rows)
    } catch (error) {
      console.error(error)
      setMessage(
        `โหลดงานไม่สำเร็จ: ${error.message}`
      )
    } finally {
      setLoading(false)
    }
  }

  if (profile?.role !== 'center') {
    return (
      <div className="settings-denied">
        ไม่มีสิทธิ์เข้าถึงหน้านี้
      </div>
    )
  }

  if (selectedTaskId) {
    return (
        <CenterTaskDetail
        taskId={selectedTaskId}
        profile={profile}
        onBack={() => {
            setSelectedTaskId(null)
            loadTasks()
        }}
        />
    )
    }

  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลดงานศูนย์...</p>
      </div>
    )
  }

  return (
    <div className="admin-tasks-page">

      <div className="admin-task-header">

        <div>
          <div className="hero-badge">
            CENTER WORKSPACE
          </div>

          <h2>งานศูนย์</h2>

          <p>
            งานที่ได้รับมอบหมายให้ศูนย์ของคุณ
          </p>
        </div>

        <button
          type="button"
          className="refresh-button"
          onClick={loadTasks}
        >
          รีเฟรชข้อมูล
        </button>

      </div>

      {message && (
        <div className="modern-alert error">
          {message}
        </div>
      )}

      <div className="admin-task-list-card">

        <h3>
          งานที่ได้รับมอบหมาย ({tasks.length})
        </h3>

        {tasks.length === 0 ? (

          <div className="empty-state">
            <h3>ยังไม่มีงานที่ได้รับมอบหมาย</h3>

            <p>
              เมื่องานถูกมอบหมายจาก Admin
              จะแสดงที่หน้านี้
            </p>
          </div>

        ) : (

          <div className="admin-task-list">

            {tasks.map((task) => (

              <div
                className="admin-task-card"
                key={task.id}
              >

                <div className="admin-task-card-top">

                  <div>

                    <span className="admin-task-category">
                      {CATEGORY_LABELS[
                        task.category
                      ] || task.category}
                    </span>

                    <h3>{task.title}</h3>

                  </div>

                  <span
                    className={`admin-task-priority ${task.priority}`}
                  >
                    {PRIORITY_LABELS[
                      task.priority
                    ] || task.priority}
                  </span>

                </div>

                {task.description && (
                  <p>
                    {task.description}
                  </p>
                )}

                <div className="admin-task-progress-head">

                  <span>สถานะงานศูนย์</span>

                  <strong>
                    {STATUS_LABELS[
                      task.center_status
                    ] || task.center_status}
                  </strong>

                </div>

                <div className="admin-task-card-actions">

                    <button
                        type="button"
                        className="admin-task-open-button"
                        onClick={() =>
                        setSelectedTaskId(task.id)
                        }
                    >
                        ดูรายละเอียดงาน
                    </button>

                </div>

              </div>

            ))}

          </div>

        )}

      </div>

    </div>
  )
}

export default CenterTasks