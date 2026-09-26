import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import AdminTaskDetail from './AdminTaskDetail'

const TASK_CATEGORIES = [
  { value: 'station', label: 'งานประจำ สภ.' },
  { value: 'south_project', label: 'โครงการงานใต้' },
  { value: 'phuket_project', label: 'โครงการงานภูเก็ต' },
  { value: 'pik', label: 'งานพี่ปิ๊ก' },
  { value: 'por', label: 'งานพี่ปอ' },
  { value: 'ood', label: 'งานพี่อู๊ด' },
  { value: 'other', label: 'งานอื่น ๆ' },
]

const PRIORITIES = [
  { value: 'normal', label: 'ปกติ' },
  { value: 'urgent', label: 'เร่งด่วน' },
  { value: 'critical', label: 'ด่วนมาก' },
]

function AdminTasks({ profile }) {
  const [tasks, setTasks] = useState([])
  const [centers, setCenters] = useState([])
  const [taskCenters, setTaskCenters] = useState([])

  const [taskSubtasks, setTaskSubtasks] = useState([])
  const [taskSubtaskCenters, setTaskSubtaskCenters] = useState([])

  const [selectedTaskId, setSelectedTaskId] = useState(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')

  const [form, setForm] = useState({
    category: 'station',
    priority: 'normal',
    title: '',
    description: '',
    note: '',
  })

  const [selectedCenterIds, setSelectedCenterIds] = useState([])
  const [subtasks, setSubtasks] = useState([''])

  const [links, setLinks] = useState([
    {
        label: '',
        url: '',
    },
    ])

  const [attachments, setAttachments] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)

    const [
      taskResult,
      centerResult,
      taskCenterResult,
      taskSubtaskResult,
      taskSubtaskCenterResult,
    ] = await Promise.all([
      supabase
        .from('admin_tasks')
        .select('*')
        .neq('status', 'archived')
        .order('created_at', {
          ascending: false,
        }),

      supabase
        .from('centers')
        .select('id, name, code, active')
        .eq('active', true)
        .order('name'),

      supabase
        .from('admin_task_centers')
        .select('task_id, center_id, status'),

      supabase
        .from('admin_task_subtasks')
        .select('id, task_id'),

      supabase
        .from('admin_task_subtask_centers')
        .select('subtask_id, center_id, status'),  
    ])

    if (taskResult.error) {
      console.error(taskResult.error)
      setMessage(taskResult.error.message)
      setMessageType('error')
    }

    if (centerResult.error) {
      console.error(centerResult.error)
    }

    if (taskCenterResult.error) {
      console.error(taskCenterResult.error)
    }

    if (taskSubtaskResult.error) {
      console.error(taskSubtaskResult.error)
    }

    if (taskSubtaskCenterResult.error) {
      console.error(taskSubtaskCenterResult.error)
}

    const centerRows = centerResult.data || []

    setTasks(taskResult.data || [])
    setCenters(centerRows)
    setTaskCenters(taskCenterResult.data || [])

    setTaskSubtasks(
      taskSubtaskResult.data || []
    )

    setTaskSubtaskCenters(
      taskSubtaskCenterResult.data || []
    )

    setSelectedCenterIds((prev) =>
      prev.length
        ? prev
        : centerRows.map((center) =>
            String(center.id)
          )
    )

    setLoading(false)
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const toggleCenter = (centerId) => {
    const value = String(centerId)

    setSelectedCenterIds((prev) =>
      prev.includes(value)
        ? prev.filter((id) => id !== value)
        : [...prev, value]
    )
  }

  const selectAllCenters = () => {
    setSelectedCenterIds(
      centers.map((center) => String(center.id))
    )
  }

  const clearCenters = () => {
    setSelectedCenterIds([])
  }

  const addSubtask = () => {
    setSubtasks((prev) => [...prev, ''])
  }

  const changeSubtask = (index, value) => {
    setSubtasks((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index ? value : item
      )
    )
  }

  const removeSubtask = (index) => {
    setSubtasks((prev) =>
      prev.filter((_, itemIndex) =>
        itemIndex !== index
      )
    )
  }

  const resetForm = () => {
    setForm({
      category: 'station',
      priority: 'normal',
      title: '',
      description: '',
      note: '',
      
    })

    setSubtasks([''])

    setLinks([
    {
        label: '',
        url: '',
    },
    ])

    setAttachments([])

    setSelectedCenterIds(
    centers.map((center) => String(center.id))
    )
  }

  const addLink = () => {
    setLinks((prev) => [
        ...prev,
        {
        label: '',
        url: '',
        },
    ])
    }

    const changeLink = (
    index,
    field,
    value
    ) => {
    setLinks((prev) =>
        prev.map((item, itemIndex) =>
        itemIndex === index
            ? {
                ...item,
                [field]: value,
            }
            : item
        )
    )
    }

    const removeLink = (index) => {
    setLinks((prev) =>
        prev.filter(
        (_, itemIndex) =>
            itemIndex !== index
        )
    )
    }

    const handleAttachments = (e) => {
        const selectedFiles =
            Array.from(e.target.files || [])

        const validFiles = []

        for (const file of selectedFiles) {

            if (file.size > 10 * 1024 * 1024) {
            setMessageType('error')
            setMessage(
                `ไฟล์ "${file.name}" มีขนาดเกิน 10 MB`
            )
            continue
            }

            validFiles.push(file)
        }

        setAttachments((prev) => [
            ...prev,
            ...validFiles,
        ])

        // ให้สามารถเลือกไฟล์เดิมซ้ำได้
        e.target.value = ''
        }


        const removeAttachment = (index) => {
        setAttachments((prev) =>
            prev.filter(
            (_, itemIndex) =>
                itemIndex !== index
            )
        )
        }


        const formatFileSize = (size) => {
        if (!size) return '0 MB'

        return `${(
            size /
            1024 /
            1024
        ).toFixed(2)} MB`
        }

  const createTask = async (e) => {
    e.preventDefault()

    const title = form.title.trim()

    if (!title) {
      setMessageType('error')
      setMessage('กรุณาระบุชื่องาน')
      return
    }

    if (selectedCenterIds.length === 0) {
      setMessageType('error')
      setMessage('กรุณาเลือกอย่างน้อย 1 ศูนย์')
      return
    }

    setSaving(true)
    setMessage('')

    let createdTaskId = null

    try {
      const {
        data: task,
        error: taskError,
      } = await supabase
        .from('admin_tasks')
        .insert({
          category: form.category,
          priority: form.priority,
          title,
          description:
            form.description.trim() || null,
          note:
            form.note.trim() || null,
          
          created_by:
            profile?.id || null,
        })
        .select('id')
        .single()

      if (taskError) throw taskError

      createdTaskId = task.id

      const uploadedFilePaths = []

        for (const file of attachments) {

        const extension =
            file.name.includes('.')
                ? file.name
                    .split('.')
                    .pop()
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '')
                : ''

            const filePath =
            `tasks/${task.id}/${crypto.randomUUID()}${
                extension ? `.${extension}` : ''
            }`

        const {
            error: uploadError,
        } = await supabase.storage
            .from('admin-task-files')
            .upload(
            filePath,
            file,
            {
                contentType:
                file.type ||
                'application/octet-stream',

                upsert: false,
            }
            )

        if (uploadError) {
            throw uploadError
        }

        uploadedFilePaths.push(
            filePath
        )

        const {
            error: fileRecordError,
        } = await supabase
            .from('admin_task_files')
            .insert({
            task_id:
                task.id,

            file_name:
                file.name,

            file_path:
                filePath,

            mime_type:
                file.type || null,

            file_size:
                file.size,
            })

        if (fileRecordError) {
            throw fileRecordError
        }
        }

      const cleanLinks = links
        .map((item) => ({
            label: item.label.trim(),
            url: item.url.trim(),
        }))
        .filter(
            (item) =>
            item.label &&
            item.url
        )

        if (cleanLinks.length > 0) {
        const { error: linkError } =
            await supabase
            .from('admin_task_links')
            .insert(
                cleanLinks.map(
                (item, index) => ({
                    task_id: task.id,
                    label: item.label,
                    url: item.url,
                    sort_order: index + 1,
                })
                )
            )

        if (linkError) {
            throw linkError
        }
        }

      const centerRows =
        selectedCenterIds.map((centerId) => ({
          task_id: task.id,
          center_id: Number(centerId),
          status: 'pending',
        }))

      const {
        error: centerInsertError,
      } = await supabase
        .from('admin_task_centers')
        .insert(centerRows)

      if (centerInsertError) {
        throw centerInsertError
      }

      const cleanSubtasks = subtasks
        .map((item) => item.trim())
        .filter(Boolean)

      if (cleanSubtasks.length > 0) {
        const {
          data: insertedSubtasks,
          error: subtaskError,
        } = await supabase
          .from('admin_task_subtasks')
          .insert(
            cleanSubtasks.map((title, index) => ({
              task_id: task.id,
              title,
              sort_order: index + 1,
            }))
          )
          .select('id')

        if (subtaskError) {
          throw subtaskError
        }

        const subtaskCenterRows = []

        insertedSubtasks.forEach((subtask) => {
          selectedCenterIds.forEach((centerId) => {
            subtaskCenterRows.push({
              subtask_id: subtask.id,
              center_id: Number(centerId),
              status: 'pending',
            })
          })
        })

        if (subtaskCenterRows.length > 0) {
          const {
            error: subtaskCenterError,
          } = await supabase
            .from('admin_task_subtask_centers')
            .insert(subtaskCenterRows)

          if (subtaskCenterError) {
            throw subtaskCenterError
          }
        }
      }

      setMessageType('success')
      setMessage('สร้างงานเรียบร้อยแล้ว')

      resetForm()
      await loadData()
    } catch (error) {
      console.error(error)

      if (createdTaskId) {
        await supabase
          .from('admin_tasks')
          .delete()
          .eq('id', createdTaskId)
      }

      setMessageType('error')
      setMessage(
        `สร้างงานไม่สำเร็จ: ${error.message}`
      )
      setLinks([
        {
            label: '',
            url: '',
        },
        ])
    } finally {
      setSaving(false)
    }
  }

  const taskProgress = useMemo(() => {

    const result = {}

    tasks.forEach((task) => {

      /*
      * หางานย่อยของงานนี้
      */
      const currentSubtasks =
        taskSubtasks.filter(
          (item) =>
            String(item.task_id) ===
            String(task.id)
        )

      /*
      * ถ้ามีงานย่อย
      * คำนวณจากงานย่อยของทุกศูนย์
      */
      if (currentSubtasks.length > 0) {

        const subtaskIds =
          new Set(
            currentSubtasks.map(
              (item) =>
                String(item.id)
            )
          )

        const rows =
          taskSubtaskCenters.filter(
            (item) =>
              subtaskIds.has(
                String(item.subtask_id)
              )
          )

        const completed =
          rows.filter(
            (item) =>
              item.status === 'completed'
          ).length

        result[task.id] = {
          total: rows.length,
          completed,

          percent:
            rows.length > 0
              ? Math.round(
                  (completed / rows.length) *
                    100
                )
              : 0,

          type: 'subtask',
        }

        return
      }

      /*
      * ไม่มีงานย่อย
      * ใช้สถานะของศูนย์เหมือนเดิม
      */
      const rows =
        taskCenters.filter(
          (item) =>
            String(item.task_id) ===
            String(task.id)
        )

      const completed =
        rows.filter(
          (item) =>
            item.status === 'completed'
        ).length

      result[task.id] = {
        total: rows.length,
        completed,

        percent:
          rows.length > 0
            ? Math.round(
                (completed / rows.length) *
                  100
              )
            : 0,

        type: 'center',
      }

    })

    return result

  }, [
    tasks,
    taskCenters,
    taskSubtasks,
    taskSubtaskCenters,
  ])

  const getCategoryLabel = (value) =>
    TASK_CATEGORIES.find(
      (item) => item.value === value
    )?.label || value

  const getPriorityLabel = (value) =>
    PRIORITIES.find(
      (item) => item.value === value
    )?.label || value

  if (profile?.role !== 'admin') {
    return (
      <div className="settings-denied">
        ไม่มีสิทธิ์เข้าถึงหน้านี้
      </div>
    )
  }



  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลดงาน...</p>
      </div>
    )
  }

  if (selectedTaskId) {
    return (
        <AdminTaskDetail
        taskId={selectedTaskId}
        profile={profile}
        onBack={() => {
            setSelectedTaskId(null)
            loadData()
        }}
        />
    )
    }

  return (
    <div className="admin-tasks-page">

      <div className="admin-task-header">
        <div>
          <div className="hero-badge">
            ADMIN WORKSPACE
          </div>

          <h2>งาน Admin</h2>

          <p>
            สร้างงาน ติดตามความคืบหน้า
            และตรวจสอบสถานะแต่ละศูนย์
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadData}
        >
          รีเฟรชข้อมูล
        </button>
      </div>

      {message && (
        <div
          className={`modern-alert ${messageType}`}
        >
          {message}
        </div>
      )}

      <div className="admin-task-layout">

        <div className="admin-task-form-card">
          <h3>สร้างงานใหม่</h3>

          <form onSubmit={createTask}>

            <div className="admin-task-form-grid">

              <div className="modern-field">
                <label>หมวดงาน</label>

                <select
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                >
                  {TASK_CATEGORIES.map((item) => (
                    <option
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="modern-field">
                <label>ความสำคัญ</label>

                <select
                  name="priority"
                  value={form.priority}
                  onChange={handleChange}
                >
                  {PRIORITIES.map((item) => (
                    <option
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

            </div>

            <div className="modern-field">
              <label>ชื่องาน</label>

              <input
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="เช่น ติดตั้ง Linux Mint ประจำศูนย์"
              />
            </div>

            <div className="modern-field">
              <label>รายละเอียด</label>

              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={4}
                placeholder="รายละเอียดงาน..."
              />
            </div>

            <div className="modern-field">
              <label>หมายเหตุ</label>

              <textarea
                name="note"
                value={form.note}
                onChange={handleChange}
                rows={2}
                placeholder="หมายเหตุเพิ่มเติม..."
              />
            </div>

            <div className="admin-task-section">

                <div className="admin-task-section-head">
                    <strong>ลิงก์ที่เกี่ยวข้อง</strong>

                    <button
                    type="button"
                    className="secondary-button"
                    onClick={addLink}
                    >
                    + เพิ่มลิงก์
                    </button>
                </div>

                <div className="admin-task-links">

                    {links.map((link, index) => (
                    <div
                        className="admin-task-link-row"
                        key={index}
                    >

                        <input
                        value={link.label}
                        onChange={(e) =>
                            changeLink(
                            index,
                            'label',
                            e.target.value
                            )
                        }
                        placeholder="ชื่อลิงก์ เช่น ดาวน์โหลด Linux Mint"
                        />

                        <input
                        value={link.url}
                        onChange={(e) =>
                            changeLink(
                            index,
                            'url',
                            e.target.value
                            )
                        }
                        placeholder="https://..."
                        />

                        {links.length > 1 && (
                        <button
                            type="button"
                            onClick={() =>
                            removeLink(index)
                            }
                        >
                            ลบ
                        </button>
                        )}

                    </div>
                    ))}

                </div>

                </div>

                {/* ไฟล์แนบ */}
                <div className="admin-task-section">

                <div className="admin-task-section-head">
                    <strong>ไฟล์แนบ</strong>

                    <span className="admin-file-limit">
                    ไม่เกิน 10 MB / ไฟล์
                    </span>
                </div>

                <label className="admin-file-picker">

                    <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.jpg,.jpeg,.png"
                    onChange={handleAttachments}
                    />

                    <div className="admin-file-picker-icon">
                    +
                    </div>

                    <div>
                    <strong>เลือกไฟล์แนบ</strong>

                    <small>
                        PDF, Word, Excel, ZIP, รูปภาพ และไฟล์ข้อความ
                    </small>
                    </div>

                </label>

                {attachments.length > 0 && (
                    <div className="admin-upload-file-list">

                    {attachments.map((file, index) => (
                        <div
                        className="admin-upload-file-item"
                        key={`${file.name}-${index}`}
                        >

                        <div className="admin-upload-file-info">

                            <div className="admin-upload-file-icon">
                            📎
                            </div>

                            <div>
                            <strong>{file.name}</strong>

                            <small>
                                {formatFileSize(file.size)}
                            </small>
                            </div>

                        </div>

                        <button
                            type="button"
                            onClick={() =>
                            removeAttachment(index)
                            }
                        >
                            ลบ
                        </button>

                        </div>
                    ))}

                    </div>
                )}

                </div>

            <div className="admin-task-section">
              <div className="admin-task-section-head">
                <strong>งานย่อย</strong>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={addSubtask}
                >
                  + เพิ่มงานย่อย
                </button>
              </div>

              {subtasks.map((subtask, index) => (
                <div
                  className="admin-subtask-row"
                  key={index}
                >
                  <input
                    value={subtask}
                    onChange={(e) =>
                      changeSubtask(
                        index,
                        e.target.value
                      )
                    }
                    placeholder={`งานย่อย ${index + 1}`}
                  />

                  {subtasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        removeSubtask(index)
                      }
                    >
                      ลบ
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="admin-task-section">

              <div className="admin-task-section-head">
                <strong>ศูนย์ที่ได้รับมอบหมาย</strong>

                <div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={selectAllCenters}
                  >
                    เลือกทั้งหมด
                  </button>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={clearCenters}
                  >
                    ล้าง
                  </button>
                </div>
              </div>

              <div className="admin-center-grid">
                {centers.map((center) => {
                  const checked =
                    selectedCenterIds.includes(
                      String(center.id)
                    )

                  return (
                    <label
                      className={`admin-center-option ${
                        checked ? 'selected' : ''
                      }`}
                      key={center.id}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          toggleCenter(center.id)
                        }
                      />

                      <span>{center.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <button
              className="primary-button"
              disabled={saving}
            >
              {saving
                ? 'กำลังสร้างงาน...'
                : 'สร้างงาน'}
            </button>

          </form>
        </div>


        <div className="admin-task-list-card">
          <h3>
            งานทั้งหมด ({tasks.length})
          </h3>

          {tasks.length === 0 ? (
            <div className="empty-state">
              <h3>ยังไม่มีงาน</h3>
              <p>สร้างงานแรกได้จากแบบฟอร์มด้านซ้าย</p>
            </div>
          ) : (
            <div className="admin-task-list">

              {tasks.map((task) => {
                const progress =
                  taskProgress[task.id] || {
                    total: 0,
                    completed: 0,
                    percent: 0,
                    type: 'center',
                  }

                return (
                  <div
                    className="admin-task-card"
                    key={task.id}
                  >
                    <div className="admin-task-card-top">
                      <div>
                        <span className="admin-task-category">
                          {getCategoryLabel(
                            task.category
                          )}
                        </span>

                        <h3>{task.title}</h3>
                      </div>

                      <span
                        className={`admin-task-priority ${task.priority}`}
                      >
                        {getPriorityLabel(
                          task.priority
                        )}
                      </span>
                    </div>

                    {task.description && (
                      <p>{task.description}</p>
                    )}

                    <div className="admin-task-progress-head">
                      <span>ความคืบหน้า</span>

                      <strong>
                        {progress.completed} /{' '}
                        {progress.total}{' '}
                        {progress.type === 'subtask'
                          ? 'งานย่อย'
                          : 'ศูนย์'}
                      </strong>
                    </div>

                    <div className="admin-task-progress">
                      <div
                        style={{
                          width: `${progress.percent}%`,
                        }}
                      />
                    </div>

                    <small>
                      {progress.percent}% เสร็จแล้ว
                    </small>

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
                )
              })}

            </div>
          )}
        </div>

      </div>
    </div>
  )
}

export default AdminTasks