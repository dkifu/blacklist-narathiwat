import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

const STATUS_OPTIONS = [
  {
    value: 'pending',
    label: 'รอดำเนินการ',
  },
  {
    value: 'doing',
    label: 'กำลังดำเนินการ',
  },
  {
    value: 'completed',
    label: 'เสร็จแล้ว',
  },
]

function CenterTaskDetail({
  taskId,
  profile,
  onBack,
}) {
  const [task, setTask] = useState(null)

  const [taskCenter, setTaskCenter] =
    useState(null)

  const [subtasks, setSubtasks] =
    useState([])

  const [savingKey, setSavingKey] =
    useState('')  

  const [
    subtaskCenters,
    setSubtaskCenters,
  ] = useState([])

  const [links, setLinks] = useState([])
  const [files, setFiles] = useState([])

  const [loading, setLoading] =
    useState(true)

  const [message, setMessage] =
    useState('')

  useEffect(() => {
    loadData()
  }, [taskId, profile?.center_id])

  const loadData = async () => {
    if (!profile?.center_id) {
      setMessage(
        'บัญชีนี้ยังไม่ได้ผูกกับศูนย์'
      )
      setLoading(false)
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const centerId =
        Number(profile.center_id)

      const [
        taskResult,
        centerResult,
        subtaskResult,
        linkResult,
        fileResult,
      ] = await Promise.all([

        supabase
          .from('admin_tasks')
          .select('*')
          .eq('id', taskId)
          .single(),

        supabase
          .from('admin_task_centers')
          .select('*')
          .eq('task_id', taskId)
          .eq('center_id', centerId)
          .maybeSingle(),

        supabase
          .from('admin_task_subtasks')
          .select('*')
          .eq('task_id', taskId)
          .order('sort_order'),

        supabase
          .from('admin_task_links')
          .select('*')
          .eq('task_id', taskId)
          .order('sort_order'),

        supabase
          .from('admin_task_files')
          .select('*')
          .eq('task_id', taskId)
          .order('created_at', {
            ascending: true,
          }),

      ])

      if (taskResult.error) {
        throw taskResult.error
      }

      if (centerResult.error) {
        throw centerResult.error
      }

      if (subtaskResult.error) {
        throw subtaskResult.error
      }

      if (linkResult.error) {
        throw linkResult.error
      }

      if (fileResult.error) {
        throw fileResult.error
      }

      const subtaskRows =
        subtaskResult.data || []

      let centerSubtaskRows = []

      const subtaskIds =
        subtaskRows.map(
          (item) => item.id
        )

      if (subtaskIds.length > 0) {
        const {
          data,
          error,
        } = await supabase
          .from(
            'admin_task_subtask_centers'
          )
          .select('*')
          .eq(
            'center_id',
            centerId
          )
          .in(
            'subtask_id',
            subtaskIds
          )

        if (error) {
          throw error
        }

        centerSubtaskRows =
          data || []
      }

      setTask(taskResult.data)
      setTaskCenter(centerResult.data)

      setSubtasks(subtaskRows)

      setSubtaskCenters(
        centerSubtaskRows
      )

      setLinks(linkResult.data || [])
      setFiles(fileResult.data || [])

    } catch (error) {
      console.error(error)

      setMessage(
        `โหลดรายละเอียดงานไม่สำเร็จ: ${error.message}`
      )

    } finally {
      setLoading(false)
    }
  }

  const getSubtaskStatus = (
    subtask
  ) => {

    if (
      subtask.scope_type === 'global'
    ) {
      return (
        subtask.global_status ||
        'pending'
      )
    }

    const relation =
      subtaskCenters.find(
        (item) =>
          String(item.subtask_id) ===
          String(subtask.id)
      )

    return (
      relation?.status ||
      'pending'
    )
  }

  const formatFileSize = (size) => {
    if (!size) return '0 MB'

    const mb =
      size / 1024 / 1024

    if (mb < 0.01) {
      return `${
        Math.round(size / 1024)
      } KB`
    }

    return `${mb.toFixed(2)} MB`
  }

  const openAttachment = async (
    file
  ) => {
    try {
      const {
        data,
        error,
      } = await supabase.storage
        .from('admin-task-files')
        .createSignedUrl(
          file.file_path,
          600
        )

      if (error) {
        throw error
      }

      window.open(
        data.signedUrl,
        '_blank',
        'noopener,noreferrer'
      )

    } catch (error) {
      console.error(error)

      setMessage(
        `เปิดไฟล์ไม่สำเร็จ: ${error.message}`
      )
    }
  }

  const updateCenterStatus = async (
  newStatus
) => {
  if (
    !taskCenter ||
    taskCenter.status === newStatus
  ) {
    return
  }

  setSavingKey('center')
  setMessage('')

  try {
    const completedAt =
      newStatus === 'completed'
        ? new Date().toISOString()
        : null

    const { error } = await supabase
      .from('admin_task_centers')
      .update({
        status: newStatus,
        completed_at: completedAt,
      })
      .eq('id', taskCenter.id)
      .eq(
        'center_id',
        Number(profile.center_id)
      )

    if (error) {
      throw error
    }

    await loadData()

  } catch (error) {
    console.error(error)

    setMessage(
      `อัปเดตสถานะไม่สำเร็จ: ${error.message}`
    )

  } finally {
    setSavingKey('')
  }
}


const updateSubtaskStatus = async (
  subtask,
  newStatus
) => {
  const relation =
    subtaskCenters.find(
      (item) =>
        String(item.subtask_id) ===
        String(subtask.id)
    )

  if (!relation) {
    setMessage(
      'ไม่พบงานย่อยที่ผูกกับศูนย์นี้'
    )
    return
  }

  if (
    relation.status === newStatus
  ) {
    return
  }

  const key =
    `subtask-${subtask.id}`

  setSavingKey(key)
  setMessage('')

  try {
    const completedAt =
      newStatus === 'completed'
        ? new Date().toISOString()
        : null

    const { error } = await supabase
      .from(
        'admin_task_subtask_centers'
      )
      .update({
        status: newStatus,
        completed_at: completedAt,
      })
      .eq('id', relation.id)
      .eq(
        'center_id',
        Number(profile.center_id)
      )

    if (error) {
      throw error
    }

    /*
     * คำนวณสถานะงานหลักของศูนย์ใหม่
     * โดยใช้เฉพาะงานย่อยที่ผูกกับศูนย์
     * ไม่รวมงาน global
     */

    const centerScopedIds =
      subtasks
        .filter(
          (item) =>
            item.scope_type !== 'global'
        )
        .map(
          (item) => item.id
        )

    if (centerScopedIds.length > 0) {
      const {
        data: statusRows,
        error: statusError,
      } = await supabase
        .from(
          'admin_task_subtask_centers'
        )
        .select(
          'subtask_id, status'
        )
        .eq(
          'center_id',
          Number(profile.center_id)
        )
        .in(
          'subtask_id',
          centerScopedIds
        )

      if (statusError) {
        throw statusError
      }

      const statuses =
        (statusRows || []).map(
          (item) => item.status
        )

      let parentStatus =
        'pending'

      const allCompleted =
        statuses.length > 0 &&
        statuses.every(
          (status) =>
            status === 'completed'
        )

      const hasProgress =
        statuses.some(
          (status) =>
            status === 'doing' ||
            status === 'completed'
        )

      if (allCompleted) {
        parentStatus = 'completed'
      } else if (hasProgress) {
        parentStatus = 'doing'
      }

      const parentCompletedAt =
        parentStatus === 'completed'
          ? new Date().toISOString()
          : null

      const { error: parentError } =
        await supabase
          .from('admin_task_centers')
          .update({
            status: parentStatus,
            completed_at:
              parentCompletedAt,
          })
          .eq('id', taskCenter.id)
          .eq(
            'center_id',
            Number(profile.center_id)
          )

      if (parentError) {
        throw parentError
      }
    }

    await loadData()

  } catch (error) {
    console.error(error)

    setMessage(
      `อัปเดตงานย่อยไม่สำเร็จ: ${error.message}`
    )

  } finally {
    setSavingKey('')
  }
}

  if (loading) {
    return (
      <div className="vehicle-list-loading">

        <div className="loader"></div>

        <p>
          กำลังโหลดรายละเอียดงาน...
        </p>

      </div>
    )
  }

  if (!task || !taskCenter) {
    return (
      <div className="empty-state">

        <h3>
          ไม่พบงานนี้
        </h3>

        <p>
          งานนี้อาจไม่ได้มอบหมาย
          ให้ศูนย์ของคุณ
        </p>

        <button
          type="button"
          className="secondary-button"
          onClick={onBack}
        >
          กลับ
        </button>

      </div>
    )
  }

  return (
    <div className="admin-task-detail">

      <div className="admin-task-detail-header">

        <button
          type="button"
          className="admin-task-back-button"
          onClick={onBack}
        >
          ← กลับรายการงาน
        </button>

        <div className="admin-task-detail-title">

          <div>
            <h2>
              {task.title}
            </h2>
          </div>

          <div className="admin-task-detail-actions">

            <span className="admin-task-category">
              {CATEGORY_LABELS[
                task.category
              ] || task.category}
            </span>

            <span
              className={
                `admin-task-priority ${task.priority}`
              }
            >
              {PRIORITY_LABELS[
                task.priority
              ] || task.priority}
            </span>

          </div>

        </div>

      </div>


      {message && (
        <div className="modern-alert error">
          {message}
        </div>
      )}


      <div className="admin-task-detail-grid">

        <div className="admin-task-detail-main">

          <div className="admin-detail-card">

            <h3>
              รายละเอียดงาน
            </h3>

            {task.description ? (
              <div className="admin-detail-description-box">

                <span>
                  รายละเอียด
                </span>

                <p className="admin-detail-description">
                  {task.description}
                </p>

              </div>
            ) : (
              <p className="admin-detail-empty">
                ไม่มีรายละเอียด
              </p>
            )}

            {task.note && (
              <div className="admin-detail-note">

                <span>
                  หมายเหตุ
                </span>

                <p>
                  {task.note}
                </p>

              </div>
            )}


            {links.length > 0 && (

              <div className="admin-detail-links">

                <span>
                  ลิงก์ที่เกี่ยวข้อง
                </span>

                {links.map(
                  (link) => (

                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >

                      <strong>
                        {link.label}
                      </strong>

                      <small>
                        {link.url}
                      </small>

                    </a>

                  )
                )}

              </div>

            )}


            {files.length > 0 && (

              <div className="admin-detail-files">

                <span>
                  ไฟล์แนบ
                </span>

                <div className="admin-detail-file-list">

                  {files.map(
                    (file) => (

                      <button
                        type="button"
                        className="admin-detail-file"
                        key={file.id}
                        onClick={() =>
                          openAttachment(
                            file
                          )
                        }
                      >

                        <div className="admin-detail-file-icon">
                          📎
                        </div>

                        <div className="admin-detail-file-info">

                          <strong>
                            {file.file_name}
                          </strong>

                          <small>
                            {formatFileSize(
                              file.file_size
                            )}
                          </small>

                        </div>

                        <span>
                          เปิดไฟล์ ↗
                        </span>

                      </button>

                    )
                  )}

                </div>

              </div>

            )}

          </div>


          <div className="admin-detail-card">

            <div className="admin-detail-section-title">

              <div>
                <h3>
                  งานที่ได้รับมอบหมาย
                </h3>

                <p>
                  แสดงเฉพาะงานของศูนย์คุณ
                </p>
              </div>

              <strong>
                {subtasks.length}
              </strong>

            </div>


            {subtasks.length === 0 ? (

              <p className="admin-detail-empty">
                ไม่มีงานย่อย
              </p>

            ) : (

              <div className="admin-center-subtasks">

                {subtasks.map(
                  (subtask) => {

                    const status =
                      getSubtaskStatus(
                        subtask
                      )

                    return (
                      <div
                        className="admin-center-subtask-row"
                        key={subtask.id}
                      >

                        <div>

                          <strong>
                            {subtask.title}
                          </strong>

                          {subtask.scope_type ===
                            'global' && (
                            <small>
                              งานภาพรวม
                            </small>
                          )}

                        </div>

                        {subtask.scope_type === 'global' ? (

                            <strong>
                                {STATUS_LABELS[
                                status
                                ] || status}
                            </strong>

                            ) : (

                            <select
                                className={
                                `admin-status-select ${status}`
                                }
                                value={status}
                                disabled={
                                savingKey ===
                                `subtask-${subtask.id}`
                                }
                                onChange={(e) =>
                                updateSubtaskStatus(
                                    subtask,
                                    e.target.value
                                )
                                }
                            >
                                {STATUS_OPTIONS.map(
                                (item) => (
                                    <option
                                    key={item.value}
                                    value={item.value}
                                    >
                                    {item.label}
                                    </option>
                                )
                                )}
                            </select>

                            )}

                      </div>
                    )
                  }
                )}

              </div>

            )}

          </div>

        </div>


        <div className="admin-task-detail-side">

          <div className="admin-detail-summary-card">

            <span>
              สถานะงานศูนย์
            </span>

            {subtasks.filter(
                (item) =>
                    item.scope_type !== 'global'
                ).length === 0 ? (

                <select
                    className={
                    `admin-status-select ${taskCenter.status}`
                    }
                    value={taskCenter.status}
                    disabled={
                    savingKey === 'center'
                    }
                    onChange={(e) =>
                    updateCenterStatus(
                        e.target.value
                    )
                    }
                >
                    {STATUS_OPTIONS.map(
                    (item) => (
                        <option
                        key={item.value}
                        value={item.value}
                        >
                        {item.label}
                        </option>
                    )
                    )}
                </select>

                ) : (

                <>
                    <strong className="admin-detail-task-status">
                    {STATUS_LABELS[
                        taskCenter.status
                    ] || taskCenter.status}
                    </strong>

                    <small>
                    คำนวณจากสถานะงานย่อยอัตโนมัติ
                    </small>
                </>

                )}

          </div>


          <div className="admin-detail-summary-card">

            <span>
              งานย่อย
            </span>

            <strong>
              {subtasks.length}
            </strong>

            <small>
              รายการที่เกี่ยวข้องกับศูนย์
            </small>

          </div>

        </div>

      </div>

    </div>
  )
}

export default CenterTaskDetail