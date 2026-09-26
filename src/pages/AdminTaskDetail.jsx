import { useEffect, useMemo, useState } from 'react'
import liff from '@line/liff'
import { supabase } from '../lib/supabase'


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

function AdminTaskDetail({
  taskId,
  profile,
  onBack,
}) {
  const [task, setTask] = useState(null)

  const [centers, setCenters] = useState([])
  const [taskCenters, setTaskCenters] =
    useState([])

  const [subtasks, setSubtasks] = useState([])
  const [
    subtaskCenters,
    setSubtaskCenters,
  ] = useState([])

  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [sharingLine, setSharingLine] = useState(false)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] =
    useState('success')

  const [links, setLinks] = useState([])  
  const [files, setFiles] = useState([])
  const [history, setHistory] = useState([])
  const [historyProfiles, setHistoryProfiles] = useState({})

  const [editMode, setEditMode] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)

  const [editMessage, setEditMessage] =
    useState('')

    const [
    editMessageType,
    setEditMessageType,
    ] = useState('success')

  const [editForm, setEditForm] = useState({
    category: 'station',
    priority: 'normal',
    title: '',
    description: '',
    note: '',
  })

  const [editLinks, setEditLinks] = useState([])
  const [editAttachments, setEditAttachments] = useState([])
  const [editSubtasks, setEditSubtasks] = useState([])

  const [deletingFileId, setDeletingFileId] =
    useState(null)
  
  

  useEffect(() => {
    loadData()
  }, [taskId])

  const loadData = async () => {
    setLoading(true)

    const [
        taskResult,
        centerResult,
        taskCenterResult,
        subtaskResult,
        linkResult,
        fileResult,
        historyResult,
        ] = await Promise.all([

        supabase
            .from('admin_tasks')
            .select('*')
            .eq('id', taskId)
            .single(),

        supabase
            .from('centers')
            .select('id, name, code, active')
            .order('name'),

        supabase
            .from('admin_task_centers')
            .select('*')
            .eq('task_id', taskId),

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

        supabase
            .from('admin_task_history')
            .select('*')
            .eq('task_id', taskId)
            .order('created_at', {
                ascending: false,
            })
            .limit(100),

        ])

    if (taskResult.error) {
      console.error(taskResult.error)

      setMessageType('error')
      setMessage(taskResult.error.message)
    }

    if (centerResult.error) {
      console.error(centerResult.error)
    }

    if (taskCenterResult.error) {
      console.error(taskCenterResult.error)
    }

    if (subtaskResult.error) {
      console.error(subtaskResult.error)
    }

    if (linkResult.error) {
      console.error(linkResult.error)
    }

    if (fileResult.error) {
        console.error(fileResult.error)
    }

    if (historyResult.error) {
        console.error(historyResult.error)
    }

    const historyRows =
        historyResult.data || []

    const profileIds = [
    ...new Set(
        [
        taskResult.data?.created_by,

        ...historyRows.map(
            (item) =>
            item.changed_by
        ),
        ].filter(Boolean)
    ),
    ]

    let profileRows = []

    if (profileIds.length > 0) {

    const {
        data,
        error,
    } = await supabase
        .from('profiles')
        .select(
        'id, username, full_name'
        )
        .in('id', profileIds)

    if (error) {
        console.error(
        'History profile error:',
        error
        )
    } else {
        profileRows = data || []
    }

    }

    const profileMap = {}

    profileRows.forEach((item) => {
    profileMap[
        String(item.id)
    ] = item
    })


    const subtaskRows =
    subtaskResult.data || []

    let subtaskCenterRows = []

    if (subtaskRows.length > 0) {
      const subtaskIds =
        subtaskRows.map((item) => item.id)

      const {
        data,
        error,
      } = await supabase
        .from('admin_task_subtask_centers')
        .select('*')
        .in('subtask_id', subtaskIds)

      if (error) {
        console.error(error)
      } else {
        subtaskCenterRows = data || []
      }
    }

    setTask(taskResult.data || null)
    setCenters(centerResult.data || [])
    setTaskCenters(
      taskCenterResult.data || []
    )
    setSubtasks(subtaskRows)
    setSubtaskCenters(subtaskCenterRows)

    setLinks(linkResult.data || [])
    setFiles(fileResult.data || [])

    setHistory(historyRows)
    setHistoryProfiles(profileMap)

    setLoading(false)
  }

  const centerMap = useMemo(() => {
    const map = {}

    centers.forEach((center) => {
      map[String(center.id)] = center
    })

    return map
  }, [centers])

  const progress = useMemo(() => {

    /*
    * ไม่มีงานย่อยเลย
    * นับแต่ละศูนย์เป็น 1 งาน
    */
    if (subtasks.length === 0) {

      const total =
        taskCenters.length

      const completed =
        taskCenters.filter(
          (item) =>
            item.status === 'completed'
        ).length

      return {
        total,
        completed,

        percent:
          total > 0
            ? Math.round(
                (completed / total) * 100
              )
            : 0,

        type: 'center',
      }
    }


    /*
    * งานภาพรวม
    * 1 รายการ = 1 work unit
    */
    const globalSubtasks =
      subtasks.filter(
        (item) =>
          (
            item.scope_type ||
            'all_centers'
          ) === 'global'
      )


    /*
    * งานย่อยที่ผูกกับศูนย์
    */
    const centerSubtaskIds =
      new Set(
        subtasks
          .filter(
            (item) =>
              (
                item.scope_type ||
                'all_centers'
              ) !== 'global'
          )
          .map(
            (item) =>
              String(item.id)
          )
      )


    const centerRows =
      subtaskCenters.filter(
        (item) =>
          centerSubtaskIds.has(
            String(item.subtask_id)
          )
      )


    /*
    * หาว่าศูนย์ไหนมีงานย่อยจริง
    */
    const centersWithSubtasks =
      new Set(
        centerRows.map(
          (row) =>
            String(row.center_id)
        )
      )


    /*
    * ศูนย์ที่ไม่มีงานย่อยของตัวเอง
    * ให้ตัวศูนย์นับเป็น 1 งาน
    */
    const standaloneCenters =
      taskCenters.filter(
        (centerRow) =>
          !centersWithSubtasks.has(
            String(centerRow.center_id)
          )
      )


    const globalCompleted =
      globalSubtasks.filter(
        (item) =>
          item.global_status ===
          'completed'
      ).length


    const centerSubtaskCompleted =
      centerRows.filter(
        (item) =>
          item.status ===
          'completed'
      ).length


    const standaloneCenterCompleted =
      standaloneCenters.filter(
        (item) =>
          item.status ===
          'completed'
      ).length


    const total =
      globalSubtasks.length +
      centerRows.length +
      standaloneCenters.length


    const completed =
      globalCompleted +
      centerSubtaskCompleted +
      standaloneCenterCompleted


    return {
      total,
      completed,

      percent:
        total > 0
          ? Math.round(
              (completed / total) * 100
            )
          : 0,

      type: 'subtask',
    }

  }, [
    taskCenters,
    subtasks,
    subtaskCenters,
  ])

  const getStatusLabel = (status) =>
    STATUS_OPTIONS.find(
      (item) => item.value === status
    )?.label || status

  const getSubtaskCenterRow = (
    subtaskId,
    centerId
  ) => {
    return subtaskCenters.find(
      (item) =>
        String(item.subtask_id) ===
          String(subtaskId) &&
        String(item.center_id) ===
          String(centerId)
    )
  }

  const writeHistory = async ({
    centerId = null,
    subtaskId = null,
    action,
    oldStatus = null,
    newStatus = null,
    note = null,
  }) => {
    const { error } = await supabase
      .from('admin_task_history')
      .insert({
        task_id: taskId,
        center_id: centerId,
        subtask_id: subtaskId,

        action,

        old_status: oldStatus,
        new_status: newStatus,

        note,

        changed_by:
          profile?.id || null,
      })

    if (error) {
      console.error(
        'History error:',
        error
      )
    }
  }

  const syncTaskStatus = async () => {

    const [
      centerResult,
      globalResult,
    ] = await Promise.all([

      supabase
        .from('admin_task_centers')
        .select('status')
        .eq('task_id', taskId),

      supabase
        .from('admin_task_subtasks')
        .select('global_status')
        .eq('task_id', taskId)
        .eq('scope_type', 'global'),

    ])


    if (centerResult.error) {
      console.error(
        centerResult.error
      )
      return
    }

    if (globalResult.error) {
      console.error(
        globalResult.error
      )
      return
    }


    const centerRows =
      centerResult.data || []

    const globalRows =
      globalResult.data || []


    /*
    * ทุกศูนย์ต้องเสร็จ
    */
    const allCentersCompleted =
      centerRows.length > 0 &&
      centerRows.every(
        (item) =>
          item.status === 'completed'
      )


    /*
    * ถ้าไม่มีงานภาพรวม
    * ถือว่าส่วนนี้ผ่าน
    *
    * ถ้ามี ต้องเสร็จทุกข้อ
    */
    const allGlobalsCompleted =
      globalRows.length === 0 ||
      globalRows.every(
        (item) =>
          item.global_status ===
          'completed'
      )


    const allCompleted =
      allCentersCompleted &&
      allGlobalsCompleted


    const nextStatus =
      allCompleted
        ? 'completed'
        : 'active'


    const {
      error: updateError,
    } = await supabase
      .from('admin_tasks')
      .update({
        status: nextStatus,
      })
      .eq('id', taskId)


    if (updateError) {
      console.error(updateError)
    }
  }  

  const updateCenterStatus = async (
    centerRow,
    newStatus
  ) => {
    if (
      centerRow.status === newStatus
    ) {
      return
    }

    const key =
      `center-${centerRow.center_id}`

    setSavingKey(key)
    setMessage('')

    try {
      const oldStatus =
        centerRow.status

      const completedAt =
        newStatus === 'completed'
          ? new Date().toISOString()
          : null

      const { error } =
        await supabase
          .from('admin_task_centers')
          .update({
            status: newStatus,
            completed_at: completedAt,
          })
          .eq('id', centerRow.id)

      if (error) {
        throw error
      }

      await writeHistory({
        centerId:
          centerRow.center_id,

        action:
          'center_status_updated',

        oldStatus,
        newStatus,
      })

      await syncTaskStatus()
      await loadData()

      setMessageType('success')
      setMessage(
        'อัปเดตสถานะเรียบร้อยแล้ว'
      )
    } catch (error) {
      console.error(error)

      setMessageType('error')

      setMessage(
        `อัปเดตสถานะไม่สำเร็จ: ${error.message}`
      )
    } finally {
      setSavingKey('')
    }
  }

  const updateGlobalSubtaskStatus = async (
    subtask,
    newStatus
  ) => {

    if (
      subtask.global_status === newStatus
    ) {
      return
    }

    const key =
      `global-subtask-${subtask.id}`

    setSavingKey(key)
    setMessage('')

    try {

      const oldStatus =
        subtask.global_status ||
        'pending'

      const completedAt =
        newStatus === 'completed'
          ? new Date().toISOString()
          : null

      const { error } =
        await supabase
          .from('admin_task_subtasks')
          .update({
            global_status: newStatus,
            global_completed_at:
              completedAt,
          })
          .eq('id', subtask.id)

      if (error) {
        throw error
      }

      await writeHistory({
        subtaskId: subtask.id,

        action:
          'global_subtask_status_updated',

        oldStatus,
        newStatus,

        note:
          'อัปเดตสถานะงานย่อยภาพรวม',
      })

      await syncTaskStatus()
      await loadData()

      setMessageType('success')
      setMessage(
        'อัปเดตงานภาพรวมเรียบร้อยแล้ว'
      )

    } catch (error) {

      console.error(error)

      setMessageType('error')
      setMessage(
        `อัปเดตงานภาพรวมไม่สำเร็จ: ${error.message}`
      )

    } finally {

      setSavingKey('')

    }
  }

  const updateSubtaskStatus = async (
    subtask,
    centerId,
    newStatus
  ) => {
    const key =
      `subtask-${subtask.id}-${centerId}`

    setSavingKey(key)
    setMessage('')

    try {
      const existingRow =
        getSubtaskCenterRow(
          subtask.id,
          centerId
        )

      const oldStatus =
        existingRow?.status ||
        'pending'

      if (oldStatus === newStatus) {
        setSavingKey('')
        return
      }

      const completedAt =
        newStatus === 'completed'
          ? new Date().toISOString()
          : null

      if (existingRow) {
        const { error } =
          await supabase
            .from(
              'admin_task_subtask_centers'
            )
            .update({
              status: newStatus,
              completed_at:
                completedAt,
            })
            .eq(
              'id',
              existingRow.id
            )

        if (error) {
          throw error
        }
      } else {
        const { error } =
          await supabase
            .from(
              'admin_task_subtask_centers'
            )
            .insert({
              subtask_id:
                subtask.id,

              center_id:
                centerId,

              status:
                newStatus,

              completed_at:
                completedAt,
            })

        if (error) {
          throw error
        }
      }

      await writeHistory({
        centerId,

        subtaskId:
          subtask.id,

        action:
          'subtask_status_updated',

        oldStatus,
        newStatus,
      })

            /*
            * อ่านเฉพาะงานย่อยที่ผูกกับศูนย์นี้
            * ไม่เอางานภาพรวมมาคิดสถานะศูนย์
            */

            const centerSubtaskIds =
              subtasks
                .filter(
                  (item) =>
                    item.scope_type !== 'global'
                )
                .map(
                  (item) => item.id
                )

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
                centerId
              )
              .in(
                'subtask_id',
                centerSubtaskIds
              )

            if (statusError) {
              throw statusError
            }

            /*
            * relation ที่มีอยู่จริง
            * = งานที่ศูนย์นี้ได้รับมอบหมายจริง
            */
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

      const parentRow =
        taskCenters.find(
          (item) =>
            String(
              item.center_id
            ) ===
            String(centerId)
        )

      if (
        parentRow &&
        parentRow.status !==
          parentStatus
      ) {
        const oldParentStatus =
          parentRow.status

        const parentCompletedAt =
          parentStatus ===
          'completed'
            ? new Date().toISOString()
            : null

        const {
          error: parentError,
        } = await supabase
          .from(
            'admin_task_centers'
          )
          .update({
            status:
              parentStatus,

            completed_at:
              parentCompletedAt,
          })
          .eq(
            'id',
            parentRow.id
          )

        if (parentError) {
          throw parentError
        }

        await writeHistory({
          centerId,

          action:
            'center_status_auto_updated',

          oldStatus:
            oldParentStatus,

          newStatus:
            parentStatus,

          note:
            'อัปเดตอัตโนมัติจากสถานะงานย่อย',
        })
      }

      await syncTaskStatus()
      await loadData()

      setMessageType('success')
      setMessage(
        'อัปเดตงานย่อยเรียบร้อยแล้ว'
      )
    } catch (error) {
      console.error(error)

      setMessageType('error')

      setMessage(
        `อัปเดตงานย่อยไม่สำเร็จ: ${error.message}`
      )
    } finally {
      setSavingKey('')
    }
  }

  const formatFileSize = (size) => {
    if (!size) return '0 MB'

    const mb = size / 1024 / 1024

    if (mb < 0.01) {
        return `${Math.round(size / 1024)} KB`
    }

    return `${mb.toFixed(2)} MB`
    }


    const openAttachment = async (file) => {
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

        setMessageType('error')
        setMessage(
        `เปิดไฟล์ไม่สำเร็จ: ${error.message}`
        )
    }
    }

    const deleteExistingFile = async (file) => {
        const confirmed = window.confirm(
            `ต้องการลบไฟล์ "${file.file_name}" ใช่หรือไม่`
        )

        if (!confirmed) return

        setDeletingFileId(file.id)
        setEditMessage('')

        try {
            // ลบ record ออกจากฐานข้อมูลก่อน
            const {
            error: deleteRecordError,
            } = await supabase
            .from('admin_task_files')
            .delete()
            .eq('id', file.id)

            if (deleteRecordError) {
            throw deleteRecordError
            }

            // แล้วลบไฟล์จริงจาก Storage
            const {
            error: storageError,
            } = await supabase.storage
            .from('admin-task-files')
            .remove([file.file_path])

            if (storageError) {
            console.error(
                'Storage delete error:',
                storageError
            )
            }

            await writeHistory({
            action: 'file_deleted',
            note: `ลบไฟล์ ${file.file_name}`,
            })

            await loadData()

            setEditMessageType('success')
            setEditMessage(
            `ลบไฟล์ "${file.file_name}" เรียบร้อยแล้ว`
            )

        } catch (error) {
            console.error(error)

            setEditMessageType('error')
            setEditMessage(
            `ลบไฟล์ไม่สำเร็จ: ${error.message}`
            )

        } finally {
            setDeletingFileId(null)
        }
        }


    const startEdit = () => {
    setEditForm({
        category: task.category || 'station',
        priority: task.priority || 'normal',
        title: task.title || '',
        description: task.description || '',
        note: task.note || '',
    })

    setEditLinks(
        links.length > 0
        ? links.map((link) => ({
            label: link.label || '',
            url: link.url || '',
            }))
        : [
            {
                label: '',
                url: '',
            },
            ]
    )

    setEditSubtasks(
      subtasks.map((item) => {

        const scopeType =
          item.scope_type ||
          'all_centers'

        const relationCenterIds =
          subtaskCenters
            .filter(
              (row) =>
                String(row.subtask_id) ===
                String(item.id)
            )
            .map(
              (row) =>
                String(row.center_id)
            )

        return {
          id: item.id,

          title:
            item.title || '',

          scope_type:
            scopeType,

          original_scope_type:
            scopeType,

          center_ids:
            scopeType === 'global'
              ? []
              : relationCenterIds,
        }
      })
    )

    setEditAttachments([])
    setEditMode(true)
    setMessage('')
    setEditMessageType('success')
    }


    const addEditLink = () => {
    setEditLinks((prev) => [
        ...prev,
        {
        label: '',
        url: '',
        },
    ])
    }


    const changeEditLink = (
    index,
    field,
    value
    ) => {
    setEditLinks((prev) =>
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


    const removeEditLink = (index) => {
    setEditLinks((prev) =>
        prev.filter(
        (_, itemIndex) =>
            itemIndex !== index
        )
      )
    }

    const addEditSubtask = () => {

      setEditSubtasks((prev) => [
        ...prev,
        {
          id: null,

          title: '',

          scope_type:
            'all_centers',

          original_scope_type:
            null,

          center_ids:
            taskCenters.map(
              (centerRow) =>
                String(
                  centerRow.center_id
                )
            ),
        },
      ])
    }

    const changeEditSubtask = (
      index,
      field,
      value
    ) => {

      setEditSubtasks((prev) =>
        prev.map(
          (item, itemIndex) => {

            if (itemIndex !== index) {
              return item
            }


            /*
            * แก้ค่าทั่วไป เช่น title
            */
            if (
              field !== 'scope_type'
            ) {

              return {
                ...item,
                [field]: value,
              }

            }


            /*
            * เปลี่ยนเป็นงานภาพรวม
            */
            if (value === 'global') {

              return {
                ...item,

                scope_type:
                  'global',

                center_ids: [],
              }

            }


            /*
            * เปลี่ยนเป็นทุกศูนย์
            */
            if (
              value === 'all_centers'
            ) {

              return {
                ...item,

                scope_type:
                  'all_centers',

                center_ids:
                  taskCenters.map(
                    (centerRow) =>
                      String(
                        centerRow.center_id
                      )
                  ),
              }

            }


            /*
            * เปลี่ยนเป็นเลือกเฉพาะศูนย์
            */
            if (
              value ===
              'specific_centers'
            ) {

              return {
                ...item,

                scope_type:
                  'specific_centers',

                /*
                * ถ้ามาจาก global
                * ให้เริ่มเลือกใหม่
                *
                * ถ้ามาจาก all/specific
                * เก็บศูนย์เดิมไว้ก่อน
                */
                center_ids:
                  item.scope_type ===
                  'global'
                    ? []
                    : (
                        item.center_ids ||
                        []
                      ),
              }

            }


            return {
              ...item,
              [field]: value,
            }
          }
        )
      )
    }

    const toggleEditSubtaskCenter = (
      index,
      centerId
    ) => {

      const value =
        String(centerId)

      setEditSubtasks((prev) =>
        prev.map(
          (item, itemIndex) => {

            if (itemIndex !== index) {
              return item
            }

            const ids =
              item.center_ids || []

            return {
              ...item,

              center_ids:
                ids.includes(value)
                  ? ids.filter(
                      (id) =>
                        id !== value
                    )
                  : [
                      ...ids,
                      value,
                    ],
            }
          }
        )
      )
    }

    const removeEditSubtask = (index) => {
      setEditSubtasks((prev) =>
        prev.filter(
          (_, itemIndex) =>
            itemIndex !== index
        )
      )
    }


    const handleEditAttachments = (e) => {
    const selected =
        Array.from(e.target.files || [])

    const valid = []

    for (const file of selected) {
        if (file.size > 10 * 1024 * 1024) {
        setEditMessageType('error')

        setEditMessage(
        `ไฟล์ "${file.name}" มีขนาดเกิน 10 MB`
        )

        continue
        }

        valid.push(file)
    }

    setEditAttachments((prev) => [
        ...prev,
        ...valid,
    ])

    e.target.value = ''
    }


    const removeEditAttachment = (index) => {
    setEditAttachments((prev) =>
        prev.filter(
        (_, itemIndex) =>
            itemIndex !== index
        )
    )
    }


    const saveEdit = async () => {
    const title =
        editForm.title.trim()

    if (!title) {
        setEditMessageType('error')
        setEditMessage('กรุณาระบุชื่องาน')
        return
        }

    setSavingEdit(true)
    setEditMessage('')

    try {

        /*
        * งานย่อย
        * รองรับ global / all_centers / specific_centers
        */

        const assignedCenterIds =
          taskCenters.map(
            (centerRow) =>
              String(centerRow.center_id)
            )


        const cleanSubtasks =
          editSubtasks
            .map((item, index) => ({

              id:
                item.id,

              title:
                String(
                  item.title || ''
                ).trim(),        

              sort_order:
                index + 1,

              scope_type:
                item.scope_type ||
                'all_centers',

              original_scope_type:
                item.original_scope_type ||
                null,

              center_ids:
                (
                  item.center_ids ||
                  []
                )        
                  .map(String)
                  .filter(
                    (centerId) =>
                      assignedCenterIds.includes(
                        centerId
                    )
                  ),

            }))
            .filter(
              (item) =>
              item.title
            )

            /*
            * specific_centers
            * ต้องเลือกอย่างน้อย 1 ศูนย์
            */
            const invalidSpecific =
              cleanSubtasks.find(
                (item) =>
                  item.scope_type ===
                    'specific_centers' &&
                        item.center_ids.length === 0
              )

              if (invalidSpecific) {
                throw new Error(
                  `งานย่อย "${invalidSpecific.title}" ยังไม่ได้เลือกศูนย์`
                )
              }        

        const {
        error: taskError,
        } = await supabase
        .from('admin_tasks')
        .update({
            category:
            editForm.category,

            priority:
            editForm.priority,

            title,

            description:
            editForm.description.trim() ||
            null,

            note:
            editForm.note.trim() ||
            null,
        })
        .eq('id', taskId)

        if (taskError) {
        throw taskError
        }


                /*
                * ลบงานย่อยเดิม
                * ที่ถูกลบออกจากหน้า Edit
                */
                const keptExistingIds =
                  cleanSubtasks
                    .filter(
                      (item) =>
                        item.id
                    )
                    .map(
                      (item) =>
                        String(item.id)
                    )


                const removedSubtasks =
                  subtasks.filter(
                    (item) =>
                      !keptExistingIds.includes(
                        String(item.id)
                      )
                  )


                for (
                  const item
                  of removedSubtasks
                ) {

                  const {
                    error:
                      deleteRelationError,
                  } = await supabase
                    .from(
                      'admin_task_subtask_centers'
                    )
                    .delete()
                    .eq(
                      'subtask_id',
                      item.id
                    )

                  if (deleteRelationError) {
                    throw deleteRelationError
                  }


                  const {
                    error:
                      deleteSubtaskError,
                  } = await supabase
                    .from(
                      'admin_task_subtasks'
                    )
                    .delete()
                    .eq(
                      'id',
                      item.id
                    )

                  if (deleteSubtaskError) {
                    throw deleteSubtaskError
                  }
                }


                /*
                * งานย่อยเดิม
                */
                const existingSubtasks =
                  cleanSubtasks.filter(
                    (item) =>
                      item.id
                  )


                for (
                  const item
                  of existingSubtasks
                ) {

                  const oldScope =
                    item.original_scope_type ||
                    'all_centers'

                  const newScope =
                    item.scope_type


                  const updateValues = {
                    title:
                      item.title,

                    sort_order:
                      item.sort_order,

                    scope_type:
                      newScope,
                  }


                  /*
                  * ถ้ามีการสลับเข้า/ออก global
                  * reset สถานะ global
                  */
                  if (
                    oldScope !== newScope &&
                    (
                      oldScope === 'global' ||
                      newScope === 'global'
                    )
                  ) {

                    updateValues.global_status =
                      'pending'

                    updateValues.global_completed_at =
                      null
                  }


                  const {
                    error:
                      updateSubtaskError,
                  } = await supabase
                    .from(
                      'admin_task_subtasks'
                    )
                    .update(
                      updateValues
                    )
                    .eq(
                      'id',
                      item.id
                    )

                  if (updateSubtaskError) {
                    throw updateSubtaskError
                  }


                  /*
                  * relation เดิมของงานย่อยนี้
                  */
                  const oldRelations =
                    subtaskCenters.filter(
                      (row) =>
                        String(
                          row.subtask_id
                        ) ===
                        String(item.id)
                    )


                  /*
                  * กำหนดศูนย์เป้าหมายใหม่
                  */
                  let targetCenterIds = []

                  if (
                    newScope ===
                    'all_centers'
                  ) {

                    targetCenterIds =
                      assignedCenterIds

                  } else if (
                    newScope ===
                    'specific_centers'
                  ) {

                    targetCenterIds =
                      item.center_ids

                  }


                  /*
                  * Global
                  * targetCenterIds = []
                  * จึงลบ relation ทั้งหมด
                  */

                  const targetSet =
                    new Set(
                      targetCenterIds.map(
                        String
                      )
                    )


                  /*
                  * relation ที่ต้องลบ
                  */
                  const removeRelations =
                    oldRelations.filter(
                      (row) =>
                        !targetSet.has(
                          String(
                            row.center_id
                          )
                        )
                    )


                  for (
                    const relation
                    of removeRelations
                  ) {

                    const {
                      error:
                        removeRelationError,
                    } = await supabase
                      .from(
                        'admin_task_subtask_centers'
                      )
                      .delete()
                      .eq(
                        'id',
                        relation.id
                      )

                    if (
                      removeRelationError
                    ) {
                      throw removeRelationError
                    }
                  }


                  /*
                  * relation ที่มีอยู่แล้ว
                  * เก็บ status เดิมไว้
                  */
                  const existingCenterSet =
                    new Set(
                      oldRelations
                        .filter(
                          (row) =>
                            targetSet.has(
                              String(
                                row.center_id
                              )
                            )
                        )
                        .map(
                          (row) =>
                            String(
                              row.center_id
                            )
                        )
                    )


                  /*
                  * relation ใหม่
                  * เริ่ม pending
                  */
                  const missingCenterIds =
                    targetCenterIds.filter(
                      (centerId) =>
                        !existingCenterSet.has(
                          String(centerId)
                        )
                    )


                  if (
                    missingCenterIds.length > 0
                  ) {

                    const relationRows =
                      missingCenterIds.map(
                        (centerId) => ({

                          subtask_id:
                            item.id,

                          center_id:
                            Number(centerId),

                          status:
                            'pending',

                          completed_at:
                            null,

                        })
                      )


                    const {
                      error:
                        insertRelationError,
                    } = await supabase
                      .from(
                        'admin_task_subtask_centers'
                      )
                      .insert(
                        relationRows
                      )

                    if (
                      insertRelationError
                    ) {
                      throw insertRelationError
                    }
                  }
                }


                /*
                * เพิ่มงานย่อยใหม่
                */
                const newSubtasks =
                  cleanSubtasks.filter(
                    (item) =>
                      !item.id
                  )


                for (
                  const item
                  of newSubtasks
                ) {

                  const {
                    data:
                      insertedSubtask,

                    error:
                      insertSubtaskError,

                  } = await supabase
                    .from(
                      'admin_task_subtasks'
                    )
                    .insert({

                      task_id:
                        taskId,

                      title:
                        item.title,

                      sort_order:
                        item.sort_order,

                      scope_type:
                        item.scope_type,

                      global_status:
                        'pending',

                      global_completed_at:
                        null,

                    })
                    .select(
                      'id'
                    )
                    .single()


                  if (
                    insertSubtaskError
                  ) {
                    throw insertSubtaskError
                  }


                  /*
                  * Global ไม่มี relation
                  */
                  if (
                    item.scope_type ===
                    'global'
                  ) {
                    continue
                  }


                  const targetCenterIds =
                    item.scope_type ===
                      'all_centers'
                      ? assignedCenterIds
                      : item.center_ids


                  if (
                    targetCenterIds.length > 0
                  ) {

                    const relationRows =
                      targetCenterIds.map(
                        (centerId) => ({

                          subtask_id:
                            insertedSubtask.id,

                          center_id:
                            Number(centerId),

                          status:
                            'pending',

                          completed_at:
                            null,

                        })
                      )


                    const {
                      error:
                        relationError,
                    } = await supabase
                      .from(
                        'admin_task_subtask_centers'
                      )
                      .insert(
                        relationRows
                      )

                    if (relationError) {
                      throw relationError
                    }
                  }
                }


                /*
                * อ่านงานย่อยล่าสุด
                * เพื่อคำนวณสถานะแต่ละศูนย์ใหม่
                */
                const {
                  data:
                    latestSubtasks,

                  error:
                    latestSubtaskError,

                } = await supabase
                  .from(
                    'admin_task_subtasks'
                  )
                  .select(
                    'id, scope_type'
                  )
                  .eq(
                    'task_id',
                    taskId
                  )


                if (
                  latestSubtaskError
                ) {
                  throw latestSubtaskError
                }


                const centerScopedIds =
                  (
                    latestSubtasks ||
                    []
                  )
                    .filter(
                      (item) =>
                        (
                          item.scope_type ||
                          'all_centers'
                        ) !== 'global'
                    )
                    .map(
                      (item) =>
                        item.id
                    )


                /*
                * คำนวณ parent status
                * ของแต่ละศูนย์ใหม่
                */
                for (
                  const centerRow
                  of taskCenters
                ) {

                  let statuses = []


                  if (
                    centerScopedIds.length > 0
                  ) {

                    const {
                      data:
                        statusRows,

                      error:
                        statusError,

                    } = await supabase
                      .from(
                        'admin_task_subtask_centers'
                      )
                      .select(
                        'status'
                      )
                      .eq(
                        'center_id',
                        centerRow.center_id
                      )
                      .in(
                        'subtask_id',
                        centerScopedIds
                      )


                    if (statusError) {
                      throw statusError
                    }


                    statuses =
                      (
                        statusRows ||
                        []
                      ).map(
                        (row) =>
                          row.status
                      )
                  }


                  /*
                  * ศูนย์ที่ไม่มีงานย่อย
                  * ไม่แก้ status อัตโนมัติ
                  */
                  if (
                    statuses.length === 0
                  ) {
                    continue
                  }


                  const allCompleted =
                    statuses.every(
                      (status) =>
                        status ===
                        'completed'
                    )


                  const hasProgress =
                    statuses.some(
                      (status) =>
                        status ===
                          'doing' ||
                        status ===
                          'completed'
                    )


                  const nextStatus =
                    allCompleted
                      ? 'completed'
                      : hasProgress
                        ? 'doing'
                        : 'pending'


                  const completedAt =
                    nextStatus ===
                      'completed'
                      ? (
                          centerRow.completed_at ||
                          new Date()
                            .toISOString()
                        )
                      : null


                  const {
                    error:
                      updateCenterError,
                  } = await supabase
                    .from(
                      'admin_task_centers'
                    )
                    .update({

                      status:
                        nextStatus,

                      completed_at:
                        completedAt,

                    })
                    .eq(
                      'id',
                      centerRow.id
                    )


                  if (
                    updateCenterError
                  ) {
                    throw updateCenterError
                  }
                }


                /*
                * คำนวณสถานะงานหลักใหม่
                */
                await syncTaskStatus()


        /*
        * ลิงก์
        */

        const cleanLinks =
        editLinks
            .map((item) => ({
            label:
                item.label.trim(),

            url:
                item.url.trim(),
            }))
            .filter(
            (item) =>
                item.label &&
                item.url
            )

        const {
        error: deleteLinkError,
        } = await supabase
        .from('admin_task_links')
        .delete()
        .eq('task_id', taskId)

        if (deleteLinkError) {
        throw deleteLinkError
        }

        if (cleanLinks.length > 0) {

        const {
            error: insertLinkError,
        } = await supabase
            .from('admin_task_links')
            .insert(
            cleanLinks.map(
                (item, index) => ({
                task_id:
                    taskId,

                label:
                    item.label,

                url:
                    item.url,

                sort_order:
                    index + 1,
                })
            )
            )

        if (insertLinkError) {
            throw insertLinkError
        }
        }


        /*
        * ไฟล์ใหม่
        */

        for (
        const file
        of editAttachments
        ) {

        const extension =
            file.name.includes('.')
                ? file.name
                    .split('.')
                    .pop()
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '')
                : ''

            const filePath =
            `tasks/${taskId}/${crypto.randomUUID()}${
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

        const {
            error: recordError,
        } = await supabase
            .from('admin_task_files')
            .insert({
            task_id:
                taskId,

            file_name:
                file.name,

            file_path:
                filePath,

            mime_type:
                file.type || null,

            file_size:
                file.size,
            })

        if (recordError) {
            await supabase.storage
            .from('admin-task-files')
            .remove([filePath])

            throw recordError
        }
        }


        await writeHistory({
        action: 'task_updated',
        note: 'แก้ไขรายละเอียดงาน',
        })


        setEditAttachments([])

        await loadData()

        setEditMessageType('success')
        setEditMessage(
        'บันทึกการแก้ไขเรียบร้อยแล้ว'
        )

    } catch (error) {

        console.error(error)
        setEditMessageType('error')

        setEditMessage(
        `แก้ไขงานไม่สำเร็จ: ${error.message}`
        )

    } finally {

        setSavingEdit(false)

    }
    }

    const historyItems = useMemo(() => {
        const items = [...history]

        const hasCreated = items.some(
            (item) =>
            item.action === 'task_created'
        )

        if (
            task?.created_at &&
            !hasCreated
        ) {
            items.push({
            id: `created-${task.id}`,
            action: 'task_created',
            created_at: task.created_at,
            changed_by: task.created_by,
            center_id: null,
            subtask_id: null,
            old_status: null,
            new_status: null,
            note: null,
            })
        }

        return items.sort(
            (a, b) =>
            new Date(b.created_at) -
            new Date(a.created_at)
        )
        }, [history, task])


        const getHistoryTitle = (action) => {
        switch (action) {
            case 'task_created':
            return 'สร้างงาน'

            case 'task_updated':
            return 'แก้ไขรายละเอียดงาน'

            case 'center_status_updated':
            return 'เปลี่ยนสถานะศูนย์'

            case 'center_status_auto_updated':
            return 'อัปเดตสถานะศูนย์อัตโนมัติ'

            case 'subtask_status_updated':
            return 'เปลี่ยนสถานะงานย่อย'

            case 'global_subtask_status_updated':
            return 'เปลี่ยนสถานะงานภาพรวม'

            case 'file_uploaded':
            return 'เพิ่มไฟล์แนบ'

            case 'file_deleted':
            return 'ลบไฟล์แนบ'

            default:
            return 'อัปเดตงาน'
        }
        }


        const getHistoryActor = (item) => {
        if (!item.changed_by) {
            return 'ระบบ'
        }

        const user =
            historyProfiles[
            String(item.changed_by)
            ]

        return (
            user?.full_name ||
            user?.username ||
            'ผู้ดูแลระบบ'
        )
        }


        const getHistoryDescription = (item) => {
        const parts = []

        if (item.center_id) {
            const center =
            centerMap[
                String(item.center_id)
            ]

            if (center) {
            parts.push(center.name)
            }
        }

        if (item.subtask_id) {
            const subtask =
            subtasks.find(
                (row) =>
                String(row.id) ===
                String(item.subtask_id)
            )

            if (subtask) {
            parts.push(
                `งานย่อย: ${subtask.title}`
            )
            }
        }

        if (
            item.old_status ||
            item.new_status
        ) {
            const oldText =
            item.old_status
                ? getStatusLabel(
                    item.old_status
                )
                : '-'

            const newText =
            item.new_status
                ? getStatusLabel(
                    item.new_status
                )
                : '-'

            parts.push(
            `${oldText} → ${newText}`
            )
        }

        if (item.note) {
            parts.push(item.note)
        }

        return parts.join(' • ')
        }

        const handleShareLine = async () => {
            try {
                setSharingLine(true)
                setMessage('')

                const liffId =
                import.meta.env.VITE_LIFF_ID

                if (!liffId) {
                throw new Error(
                    'ไม่พบ VITE_LIFF_ID'
                )
                }

                await liff.init({
                liffId,
                })

                if (!liff.isLoggedIn()) {
                liff.login()
                return
                }

                if (
                !liff.isApiAvailable(
                    'shareTargetPicker'
                )
                ) {
                throw new Error(
                    'อุปกรณ์หรือ Browser นี้ไม่รองรับการแชร์เข้า LINE'
                )
                }


                const statusConfig = {
                pending: {
                    label: 'รอดำเนินการ',
                    icon: '⏳',
                    color: '#B7791F',
                },

                doing: {
                    label: 'กำลังดำเนินการ',
                    icon: '🔄',
                    color: '#2563EB',
                },

                completed: {
                    label: 'เสร็จแล้ว',
                    icon: '✅',
                    color: '#16A34A',
                },
                }


                const globalSubtaskContents =
                  subtasks
                    .filter(
                      (item) =>
                        (
                          item.scope_type ||
                          'all_centers'
                        ) === 'global'
                    )
                    .sort(
                      (a, b) =>
                        (a.sort_order || 0) -
                        (b.sort_order || 0)
                    )
                    .slice(0, 5)
                    .map((subtask) => {

                      const status =
                        statusConfig[
                          subtask.global_status
                        ] ||
                        statusConfig.pending

                      return {
                        type: 'box',
                        layout: 'horizontal',
                        spacing: 'sm',
                        margin: 'sm',

                        contents: [
                          {
                            type: 'text',
                            text:
                              `${subtask.sort_order}. ${subtask.title}`,
                            size: 'xs',
                            color: '#374151',
                            wrap: true,
                            flex: 1,
                          },

                          {
                            type: 'text',
                            text:
                              `${status.icon} ${status.label}`,
                            size: 'xs',
                            color:
                              status.color,
                            weight: 'bold',
                            align: 'end',
                            flex: 0,
                          },
                        ],
                      }
                    })


                const globalSubtaskCount =
                  subtasks.filter(
                    (item) =>
                      (
                        item.scope_type ||
                        'all_centers'
                      ) === 'global'
                  ).length


                const centerContents =
                  taskCenters.map(
                    (centerRow) => {

                      const centerId =
                        String(centerRow.center_id)

                      const center =
                        centerMap[centerId]

                      const centerStatus =
                        statusConfig[
                          centerRow.status
                        ] ||
                        statusConfig.pending


                      /*
                      * หางานย่อยที่มอบหมาย
                      * ให้ศูนย์นี้จริง
                      */
                      const assignedSubtasks =
                        subtaskCenters
                          .filter(
                            (row) =>
                              String(row.center_id) ===
                              centerId
                          )
                          .map((row) => {

                            const subtask =
                              subtasks.find(
                                (item) =>
                                  String(item.id) ===
                                    String(
                                      row.subtask_id
                                    ) &&
                                  (
                                    item.scope_type ||
                                    'all_centers'
                                  ) !== 'global'
                              )

                            if (!subtask) {
                              return null
                            }

                            return {
                              subtask,
                              relation: row,
                            }
                          })
                          .filter(Boolean)
                          .sort(
                            (a, b) =>
                              (
                                a.subtask.sort_order ||
                                0
                              ) -
                              (
                                b.subtask.sort_order ||
                                0
                              )
                          )


                      /*
                      * LINE ไม่ควรยาวเกินไป
                      * แสดงสูงสุด 4 งานต่อศูนย์
                      */
                      const visibleSubtasks =
                        assignedSubtasks.slice(0, 4)

                      const hiddenCount =
                        Math.max(
                          assignedSubtasks.length -
                            visibleSubtasks.length,
                          0
                        )


                      const subtaskContents =
                        visibleSubtasks.map(
                          ({
                            subtask,
                            relation,
                          }) => {

                            const status =
                              statusConfig[
                                relation.status
                              ] ||
                              statusConfig.pending

                            return {
                              type: 'box',
                              layout: 'horizontal',
                              spacing: 'sm',
                              margin: 'sm',

                              contents: [
                                {
                                  type: 'text',
                                  text:
                                    `${subtask.sort_order}. ${subtask.title}`,
                                  size: 'xs',
                                  color: '#4B5563',
                                  wrap: true,
                                  flex: 1,
                                  maxLines: 2,
                                },

                                {
                                  type: 'text',
                                  text:
                                    `${status.icon} ${status.label}`,
                                  size: 'xs',
                                  color:
                                    status.color,
                                  weight: 'bold',
                                  align: 'end',
                                  flex: 0,
                                },
                              ],
                            }
                          }
                        )


                      return {
                        type: 'box',
                        layout: 'vertical',
                        margin: 'md',
                        paddingAll: '12px',

                        backgroundColor:
                          '#F8FAFC',

                        cornerRadius:
                          '10px',

                        contents: [

                          /*
                          * หัวศูนย์
                          */
                          {
                            type: 'box',
                            layout: 'horizontal',
                            spacing: 'sm',

                            contents: [
                              {
                                type: 'text',
                                text:
                                  center?.name ||
                                  `Center ${centerId}`,
                                size: 'sm',
                                weight: 'bold',
                                color: '#111827',
                                flex: 1,
                                wrap: true,
                              },

                              {
                                type: 'text',
                                text:
                                  `${centerStatus.icon} ${centerStatus.label}`,
                                size: 'xs',
                                color:
                                  centerStatus.color,
                                weight: 'bold',
                                align: 'end',
                                flex: 0,
                              },
                            ],
                          },


                          /*
                          * งานย่อยของศูนย์
                          */
                          ...(subtaskContents.length > 0
                            ? [
                                {
                                  type: 'separator',
                                  margin: 'sm',
                                },

                                ...subtaskContents,
                              ]
                            : []),


                          /*
                          * ถ้ามีมากกว่า 4 งาน
                          */
                          ...(hiddenCount > 0
                            ? [
                                {
                                  type: 'text',
                                  text:
                                    `+ อีก ${hiddenCount} งาน`,
                                  size: 'xs',
                                  color: '#6B7280',
                                  margin: 'sm',
                                  align: 'end',
                                },
                              ]
                            : []),
                        ],
                      }
                    }
                  )

                /*
                * สร้าง URL สำหรับไฟล์แนบ
                * อายุ 7 วัน
                */

                const fileLinks = []
                /*
                for (
                const file
                of files.slice(0, 3)
                ) {
                const {
                    data,
                    error,
                } = await supabase.storage
                    .from('admin-task-files')
                    .createSignedUrl(
                    file.file_path,
                    60 * 60 * 24 * 7
                    )

                if (
                    !error &&
                    data?.signedUrl
                ) {
                    fileLinks.push({
                    name:
                        file.file_name,

                    url:
                        data.signedUrl,
                    })
                }
                } */


                const relatedLinks =
                links
                    .filter(
                    (item) =>
                        /^https?:\/\//i.test(
                        item.url || ''
                        )
                    )
                    .slice(0, 3)


                const flexMessage = {
                type: 'flex',

                altText:
                    `📋 งาน Admin: ${task.title}`,

                contents: {
                    type: 'bubble',
                    size: 'mega',

                    header: {
                    type: 'box',
                    layout: 'vertical',

                    backgroundColor:
                        '#111827',

                    paddingAll: '18px',

                    contents: [
                        {
                        type: 'text',
                        text: '📋 งาน Admin',
                        color: '#F43F5E',
                        size: 'sm',
                        weight: 'bold',
                        },

                        {
                        type: 'text',
                        text: task.title,
                        color: '#FFFFFF',
                        size: 'xl',
                        weight: 'bold',
                        wrap: true,
                        margin: 'sm',
                        },

                        {
                        type: 'text',
                        text:
                            `${CATEGORY_LABELS[
                            task.category
                            ] || task.category} • ${
                            PRIORITY_LABELS[
                                task.priority
                            ] || task.priority
                            }`,
                        color: '#AAB4C4',
                        size: 'xs',
                        wrap: true,
                        margin: 'sm',
                        },
                    ],
                    },


                    body: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'md',

                    contents: [

                        ...(task.description
                        ? [
                            {
                                type: 'text',
                                text:
                                task.description,
                                size: 'sm',
                                color: '#444444',
                                wrap: true,
                                maxLines: 8,
                            },
                            ]
                        : []),


                        {
                        type: 'separator',
                        },


                        {
                        type: 'box',
                        layout: 'horizontal',

                        contents: [
                            {
                            type: 'text',
                            text:
                                'ความคืบหน้า',
                            size: 'sm',
                            color: '#777777',
                            flex: 1,
                            },

                            {
                            type: 'text',
                            text:
                              `${progress.completed}/${progress.total} รายการงาน (${progress.percent}%)`,
                            size: 'sm',
                            weight: 'bold',
                            color: '#C51F47',
                            align: 'end',
                            flex: 0,
                            },
                        ],
                        },


                        /*
                        * งานภาพรวม
                        */
                        ...(globalSubtaskContents.length > 0
                          ? [
                              {
                                type: 'separator',
                                margin: 'md',
                              },

                              {
                                type: 'text',
                                text: 'งานภาพรวม',
                                size: 'sm',
                                weight: 'bold',
                                color: '#111827',
                                margin: 'md',
                              },

                              ...globalSubtaskContents,

                              ...(globalSubtaskCount > 5
                                ? [
                                    {
                                      type: 'text',
                                      text:
                                        `+ อีก ${
                                          globalSubtaskCount - 5
                                        } งาน`,
                                      size: 'xs',
                                      color: '#6B7280',
                                      align: 'end',
                                      margin: 'sm',
                                    },
                                  ]
                                : []),
                            ]
                          : []),


                        /*
                        * สถานะแต่ละศูนย์
                        */
                        {
                          type: 'separator',
                          margin: 'md',
                        },

                        {
                          type: 'text',
                          text:
                            'สถานะแต่ละศูนย์',
                          size: 'sm',
                          weight: 'bold',
                          color: '#111827',
                          margin: 'md',
                        },

                        ...centerContents,


                        ...(task.note
                        ? [
                            {
                                type: 'separator',
                                margin: 'md',
                            },

                            {
                                type: 'text',
                                text:
                                `หมายเหตุ: ${task.note}`,
                                size: 'xs',
                                color: '#777777',
                                wrap: true,
                            },
                            ]
                        : []),


                        ...(relatedLinks.length > 0
                        ? [
                            {
                                type: 'separator',
                                margin: 'md',
                            },

                            {
                                type: 'text',
                                text:
                                'ลิงก์ที่เกี่ยวข้อง',
                                size: 'sm',
                                weight: 'bold',
                            },

                            ...relatedLinks.map(
                                (link) => ({
                                type: 'button',
                                style: 'link',
                                height: 'sm',

                                action: {
                                    type: 'uri',
                                    label:
                                    link.label
                                        .slice(
                                        0,
                                        20
                                        ),

                                    uri:
                                    link.url,
                                },
                                })
                            ),
                            ]
                        : []),


                        ...(fileLinks.length > 0
                        ? [
                            {
                                type: 'separator',
                                margin: 'md',
                            },

                            {
                                type: 'text',
                                text: 'ไฟล์แนบ',
                                size: 'sm',
                                weight: 'bold',
                            },

                            ...fileLinks.map(
                                (file) => ({
                                type: 'button',
                                style: 'link',
                                height: 'sm',

                                action: {
                                    type: 'uri',

                                    label:
                                    `📎 ${file.name}`
                                        .slice(
                                        0,
                                        20
                                        ),

                                    uri:
                                    file.url,
                                },
                                })
                            ),
                            ]
                        : []),
                    ],
                    },


                    footer: {
                    type: 'box',
                    layout: 'vertical',

                    contents: [
                        {
                        type: 'text',

                        text:
                            task.status ===
                            'completed'
                            ? '✅ งานเสร็จเรียบร้อยแล้ว'
                            : `ติดตามงาน • ${progress.percent}% เสร็จแล้ว`,

                        align: 'center',
                        weight: 'bold',
                        size: 'sm',

                        color:
                            task.status ===
                            'completed'
                            ? '#16A34A'
                            : '#C51F47',
                        },
                    ],
                    },
                },
                }


                const result =
                await liff.shareTargetPicker(
                    [flexMessage],
                    {
                    isMultiple: true,
                    }
                )

                if (
                result?.status ===
                'success'
                ) {
                setMessageType('success')

                setMessage(
                    'แชร์งานเข้า LINE เรียบร้อยแล้ว'
                )
                }

            } catch (error) {

                console.error(error)

                setMessageType('error')

                setMessage(
                `แชร์เข้า LINE ไม่สำเร็จ: ${
                    error?.message ||
                    'เกิดข้อผิดพลาด'
                }`
                )

            } finally {

                setSharingLine(false)

            }
            }

  const formatDate = (value) => {
    if (!value) return '-'

    try {
      return new Intl.DateTimeFormat(
        'th-TH',
        {
          dateStyle: 'medium',
          timeStyle: 'short',
        }
      ).format(new Date(value))
    } catch {
      return value
    }
  }

  if (loading) {
    return (
      <div className="vehicle-list-loading">
        <div className="loader"></div>
        <p>กำลังโหลดรายละเอียดงาน...</p>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="empty-state">
        <h3>ไม่พบงานนี้</h3>

        <button
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
            <h2>{task.title}</h2>
          </div>

          <div className="admin-task-detail-actions">

            <span className="admin-task-category">
              {CATEGORY_LABELS[task.category] || task.category}
            </span>

            <span
              className={`admin-task-priority ${task.priority}`}
            >
              {PRIORITY_LABELS[task.priority] || task.priority}
            </span>

            <button
              type="button"
              className="admin-line-share-button"
              onClick={handleShareLine}
              disabled={sharingLine}
            >
              <span className="admin-line-share-icon">L</span>
              <span>
                {sharingLine ? 'กำลังเปิด LINE...' : 'ส่ง LINE'}
              </span>
            </button>

            <button
              type="button"
              className="admin-task-edit-button"
              onClick={startEdit}
            >
              ✎ แก้ไขงาน
            </button>
          </div>
        </div>

      </div>


      {message && (
        <div
          className={`modern-alert ${messageType}`}
        >
          {message}
        </div>
      )}


      <div className="admin-task-detail-grid">

        <div className="admin-task-detail-main">

          <div className="admin-detail-card">

            <h3>รายละเอียดงาน</h3>

            {task.description ? (
                <div className="admin-detail-description-box">

                    <span>รายละเอียด</span>

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
                <span>หมายเหตุ</span>

                <p>{task.note}</p>
              </div>
            )}

            {links.length > 0 && (
                <div className="admin-detail-links">

                    <span>ลิงก์ที่เกี่ยวข้อง</span>

                    {links.map((link) => (
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
                    ))}

                </div>
                )}

                {files.length > 0 && (

                    <div className="admin-detail-files">

                        <span>ไฟล์แนบ</span>

                        <div className="admin-detail-file-list">

                        {files.map((file) => (

                            <button
                            type="button"
                            className="admin-detail-file"
                            key={file.id}
                            onClick={() =>
                                openAttachment(file)
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

                        ))}

                        </div>

                    </div>

                    )}

                

            <div className="admin-detail-meta">

              <div>
                <span>สร้างเมื่อ</span>

                <strong>
                  {formatDate(
                    task.created_at
                  )}
                </strong>
              </div>

              <div>
                <span>งานย่อย</span>

                <strong>
                  {subtasks.length} รายการ
                </strong>
              </div>

              <div>
                <span>ศูนย์</span>

                <strong>
                  {taskCenters.length} ศูนย์
                </strong>
              </div>

            </div>

          </div>

          {subtasks.some(
            (item) =>
              item.scope_type === 'global'
          ) && (

            <div className="admin-detail-card">

              <div className="admin-detail-section-title">

                <div>
                  <h3>งานภาพรวม</h3>

                  <p>
                    งานที่ดำเนินการครั้งเดียว
                    และไม่ผูกกับศูนย์ใด
                  </p>
                </div>

              </div>


              <div className="admin-center-subtasks">

                {subtasks
                  .filter(
                    (item) =>
                      item.scope_type === 'global'
                  )
                  .map((subtask) => {

                    const status =
                      subtask.global_status ||
                      'pending'

                    const key =
                      `global-subtask-${subtask.id}`

                    return (

                      <div
                        className="admin-center-subtask-row"
                        key={subtask.id}
                      >

                        <div className="admin-center-subtask-name">

                          <span>
                            {subtask.sort_order}.
                          </span>

                          <strong>
                            {subtask.title}
                          </strong>

                        </div>

                        <select
                          className={`admin-status-select ${status}`}
                          value={status}
                          disabled={
                            savingKey === key
                          }
                          onChange={(e) =>
                            updateGlobalSubtaskStatus(
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

                      </div>

                    )
                  })}

              </div>

            </div>

          )}


          <div className="admin-detail-card">

            <div className="admin-detail-section-title">
              <div>
                <h3>
                  สถานะแต่ละศูนย์
                </h3>

                <p>
                  ติดตามงานและงานย่อยของแต่ละศูนย์
                </p>
              </div>

              <strong>
                {progress.completed} /{' '}
                {progress.total}
              </strong>
            </div>


            <div className="admin-detail-progress">
              <div
                style={{
                  width:
                    `${progress.percent}%`,
                }}
              />
            </div>

            <div className="admin-detail-percent">
              {progress.percent}% เสร็จแล้ว
            </div>


            <div className="admin-center-status-list">

              {taskCenters.map(
                (centerRow) => {
                  const center =
                    centerMap[
                      String(
                        centerRow.center_id
                      )
                    ]

                  const centerSubtasks =
                    subtasks.filter(
                      (subtask) => {

                        if (
                          subtask.scope_type === 'global'
                        ) {
                          return false
                        }

                        return Boolean(
                          getSubtaskCenterRow(
                            subtask.id,
                            centerRow.center_id
                          )
                        )
                      }
                    )

                  return (
                    <div
                      className="admin-center-status-card"
                      key={centerRow.id}
                    >

                      <div className="admin-center-status-head">

                        <div>
                          <h4>
                            {center?.name ||
                              `Center ${centerRow.center_id}`}
                          </h4>

                          {center?.code && (
                            <small>{center.code}</small>
                          )}
                        </div>

                        <div className="admin-center-status-right">

                          {centerRow.completed_at && (
                            <div className="admin-center-completed-time">
                              เสร็จเมื่อ{' '}
                              {formatDate(centerRow.completed_at)}
                            </div>
                          )}

                          {centerSubtasks.length === 0 ? (
                            <select
                              className={`admin-status-select ${centerRow.status}`}
                              value={centerRow.status}
                              disabled={
                                savingKey ===
                                `center-${centerRow.center_id}`
                              }
                              onChange={(e) =>
                                updateCenterStatus(
                                  centerRow,
                                  e.target.value
                                )
                              }
                            >
                              {STATUS_OPTIONS.map((item) => (
                                <option
                                  key={item.value}
                                  value={item.value}
                                >
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`admin-status-badge ${centerRow.status}`}
                            >
                              {getStatusLabel(centerRow.status)}
                            </span>
                          )}

                        </div>

                      </div>

                         
                           

                        


                      {centerSubtasks.length > 0 && (
                        <div className="admin-center-subtasks">

                          {centerSubtasks.map(
                            (subtask) => {  
                              const relation =
                                getSubtaskCenterRow(
                                  subtask.id,
                                  centerRow.center_id
                                )

                              const status =
                                relation?.status ||
                                'pending'

                              const key =
                                `subtask-${subtask.id}-${centerRow.center_id}`

                              return (
                                <div
                                  className="admin-center-subtask-row"
                                  key={
                                    subtask.id
                                  }
                                >

                                  <div className="admin-center-subtask-name">

                                    <span>
                                      {subtask.sort_order}.
                                    </span>

                                    <strong>
                                      {subtask.title}
                                    </strong>

                                  </div>

                                  <select
                                    className={`admin-status-select ${status}`}
                                    value={
                                      status
                                    }
                                    disabled={
                                      savingKey ===
                                      key
                                    }
                                    onChange={(e) =>
                                      updateSubtaskStatus(
                                        subtask,
                                        centerRow.center_id,
                                        e.target.value
                                      )
                                    }
                                  >
                                    {STATUS_OPTIONS.map(
                                      (item) => (
                                        <option
                                          key={
                                            item.value
                                          }
                                          value={
                                            item.value
                                          }
                                        >
                                          {item.label}
                                        </option>
                                      )
                                    )}
                                  </select>

                                </div>
                              )
                            }
                          )}

                        </div>
                      )}

                      

                    </div>
                  )
                }
              )}

              

            </div>

          </div>

        </div>

        


        <div className="admin-task-detail-side">

          <div className="admin-detail-summary-card">

            <span>ความคืบหน้า</span>

            <strong>
              {progress.percent}%
            </strong>

            <small>
              {progress.completed} จาก{' '}
              {progress.total}{' '}
              {progress.type === 'subtask'
                ? 'งานย่อย'
                : 'ศูนย์'}
            </small>

          </div>


          <div className="admin-detail-summary-card">

            <span>สถานะงาน</span>

            <strong className="admin-detail-task-status">
              {task.status ===
              'completed'
                ? 'เสร็จแล้ว'
                : 'กำลังดำเนินการ'}
            </strong>

          </div>

        </div>

      </div>

      {editMode && (

        <div className="admin-edit-overlay">

            <div className="admin-edit-modal">

            <div className="admin-edit-modal-head">

                <div>
                <small>
                    ADMIN TASK
                </small>

                <h3>
                    แก้ไขงาน
                </h3>
                </div>

                <button
                type="button"
                onClick={() =>
                    setEditMode(false)
                }
                >
                ×
                </button>

            </div>
            
            {editMessage && (
                <div
                    className={`modern-alert ${editMessageType} admin-edit-message`}
                >
                    {editMessage}
                </div>
            )}


            <div className="admin-edit-grid">

                <div className="modern-field">

                <label>
                    หมวดงาน
                </label>

                <select
                    value={
                    editForm.category
                    }
                    onChange={(e) =>
                    setEditForm(
                        (prev) => ({
                        ...prev,
                        category:
                            e.target.value,
                        })
                    )
                    }
                >

                    {Object.entries(
                    CATEGORY_LABELS
                    ).map(
                    ([value, label]) => (

                        <option
                        value={value}
                        key={value}
                        >
                        {label}
                        </option>

                    )
                    )}

                </select>

                </div>


                <div className="modern-field">

                <label>
                    ความสำคัญ
                </label>

                <select
                    value={
                    editForm.priority
                    }
                    onChange={(e) =>
                    setEditForm(
                        (prev) => ({
                        ...prev,
                        priority:
                            e.target.value,
                        })
                    )
                    }
                >

                    {Object.entries(
                    PRIORITY_LABELS
                    ).map(
                    ([value, label]) => (

                        <option
                        value={value}
                        key={value}
                        >
                        {label}
                        </option>

                    )
                    )}

                </select>

                </div>

            </div>


            <div className="modern-field">

                <label>ชื่องาน</label>

                <input
                value={editForm.title}
                onChange={(e) =>
                    setEditForm(
                    (prev) => ({
                        ...prev,
                        title:
                        e.target.value,
                    })
                    )
                }
                />

            </div>


            <div className="modern-field">

                <label>
                รายละเอียด
                </label>

                <textarea
                rows={5}
                value={
                    editForm.description
                }
                onChange={(e) =>
                    setEditForm(
                    (prev) => ({
                        ...prev,
                        description:
                        e.target.value,
                    })
                    )
                }
                />

            </div>


            <div className="modern-field">

                <label>
                หมายเหตุ
                </label>

                <textarea
                rows={3}
                value={
                    editForm.note
                }
                onChange={(e) =>
                    setEditForm(
                    (prev) => ({
                        ...prev,
                        note:
                        e.target.value,
                    })
                    )
                }
                />

            </div>

            <div className="admin-edit-section">

              <div className="admin-edit-section-head">
                <strong>งานย่อย</strong>

                <button
                  type="button"
                  onClick={addEditSubtask}
                >
                  + เพิ่มงานย่อย
                </button>
              </div>

              <div className="admin-edit-subtask-list">

              {editSubtasks.length === 0 ? (

                <div className="admin-edit-subtask-empty">
                  ไม่มีงานย่อย
                </div>

              ) : (

                editSubtasks.map((item, index) => (

                  <div
                    className="admin-subtask-scope-card"
                    key={item.id || `new-${index}`}
                  >

                    <div className="admin-subtask-row">

                      <input
                        value={item.title}
                        placeholder={`งานย่อย ${index + 1}`}
                        onChange={(e) =>
                          changeEditSubtask(
                            index,
                            'title',
                            e.target.value
                          )
                        }
                      />

                      <button
                        type="button"
                        onClick={() =>
                          removeEditSubtask(index)
                        }
                      >
                        ลบ
                      </button>

                    </div>


                    <div className="admin-subtask-scope-row">

                      <label>
                        ขอบเขตงาน
                      </label>

                      <select
                        value={
                          item.scope_type ||
                          'all_centers'
                        }
                        onChange={(e) =>
                          changeEditSubtask(
                            index,
                            'scope_type',
                            e.target.value
                          )
                        }
                      >

                        <option value="global">
                          ภาพรวมของงาน
                        </option>

                        <option value="all_centers">
                          ทุกศูนย์ที่ได้รับมอบหมาย
                        </option>

                        <option value="specific_centers">
                          เลือกเฉพาะศูนย์
                        </option>

                      </select>

                    </div>


                    {item.scope_type ===
                      'specific_centers' && (

                      <div className="admin-subtask-center-picker">

                        <span>
                          เลือกศูนย์สำหรับงานย่อยนี้
                        </span>

                        <div className="admin-subtask-center-grid">

                          {taskCenters.map(
                            (centerRow) => {

                              const centerId =
                                String(
                                  centerRow.center_id
                                )

                              const center =
                                centerMap[
                                  centerId
                                ]

                              const checked =
                                (
                                  item.center_ids ||
                                  []
                                ).includes(
                                  centerId
                                )

                              return (

                                <label
                                  className={
                                    `admin-subtask-center-option ${
                                      checked
                                        ? 'selected'
                                        : ''
                                    }`
                                  }
                                  key={centerId}
                                >

                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      toggleEditSubtaskCenter(
                                        index,
                                        centerId
                                      )
                                    }
                                  />

                                  <span>
                                    {center?.name ||
                                      `Center ${centerId}`}
                                  </span>

                                </label>

                              )
                            }
                          )}

                        </div>

                      </div>

                    )}

                  </div>

                ))

              )}  

              </div>

            </div>


            <div className="admin-edit-section">

                <div className="admin-edit-section-head">

                <strong>
                    ลิงก์ที่เกี่ยวข้อง
                </strong>

                <button
                    type="button"
                    onClick={addEditLink}
                >
                    + เพิ่มลิงก์
                </button>

                </div>

                {editLinks.map(
                (link, index) => (

                    <div
                    className="admin-task-link-row"
                    key={index}
                    >

                    <input
                        value={link.label}
                        placeholder="ชื่อลิงก์"
                        onChange={(e) =>
                        changeEditLink(
                            index,
                            'label',
                            e.target.value
                        )
                        }
                    />

                    <input
                        value={link.url}
                        placeholder="https://..."
                        onChange={(e) =>
                        changeEditLink(
                            index,
                            'url',
                            e.target.value
                        )
                        }
                    />

                    {editLinks.length > 1 && (

                        <button
                        type="button"
                        onClick={() =>
                            removeEditLink(
                            index
                            )
                        }
                        >
                        ลบ
                        </button>

                    )}

                    </div>

                )
                )}

            </div>

            <div className="admin-edit-section">

                <div className="admin-edit-section-head">

                    <strong>
                    ไฟล์แนบ
                    </strong>

                    <small>
                    ไม่เกิน 10 MB / ไฟล์
                    </small>

                </div>


                {files.length > 0 && (

                    <div className="admin-edit-existing-files">

                    <div className="admin-edit-existing-title">
                        ไฟล์ปัจจุบัน
                    </div>

                    {files.map((file) => (

                        <div
                        className="admin-edit-existing-file"
                        key={file.id}
                        >

                        <div className="admin-edit-existing-file-info">

                            <div className="admin-upload-file-icon">
                            📎
                            </div>

                            <div>
                            <strong>
                                {file.file_name}
                            </strong>

                            <small>
                                {formatFileSize(
                                file.file_size
                                )}
                            </small>
                            </div>

                        </div>


                        <div className="admin-edit-existing-file-actions">

                            <button
                            type="button"
                            className="admin-file-open-button"
                            onClick={() =>
                                openAttachment(file)
                            }
                            >
                            เปิดไฟล์
                            </button>

                            <button
                            type="button"
                            className="admin-file-delete-button"
                            disabled={
                                deletingFileId ===
                                file.id
                            }
                            onClick={() =>
                                deleteExistingFile(file)
                            }
                            >
                            {deletingFileId === file.id
                                ? 'กำลังลบ...'
                                : 'ลบ'}
                            </button>

                        </div>

                        </div>

                    ))}

                    </div>

                )}


                <label className="admin-file-picker">

                    <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.jpg,.jpeg,.png"
                    onChange={
                        handleEditAttachments
                    }
                    />

                    <div className="admin-file-picker-icon">
                    +
                    </div>

                    <div>
                    <strong>
                        เพิ่มไฟล์ใหม่
                    </strong>

                    <small>
                        PDF, Word, Excel, ZIP, รูปภาพ และไฟล์ข้อความ
                    </small>
                    </div>

                </label>


                {editAttachments.length > 0 && (

                    <div className="admin-upload-file-list">

                    {editAttachments.map(
                        (file, index) => (

                        <div
                            className="admin-upload-file-item"
                            key={`${file.name}-${index}`}
                        >

                            <div className="admin-upload-file-info">

                            <div className="admin-upload-file-icon">
                                📎
                            </div>

                            <div>
                                <strong>
                                {file.name}
                                </strong>

                                <small>
                                {formatFileSize(
                                    file.size
                                )}
                                </small>
                            </div>

                            </div>

                            <button
                            type="button"
                            onClick={() =>
                                removeEditAttachment(index)
                            }
                            >
                            ลบ
                            </button>

                        </div>

                        )
                    )}

                    </div>

                )}

                </div>

            <div className="admin-edit-actions">

                <button
                type="button"
                className="secondary-button"
                onClick={() =>
                    setEditMode(false)
                }
                disabled={savingEdit}
                >
                ยกเลิก
                </button>

                <button
                type="button"
                className="primary-button"
                onClick={saveEdit}
                disabled={savingEdit}
                >
                {savingEdit
                    ? 'กำลังบันทึก...'
                    : 'บันทึกการแก้ไข'}
                </button>

            </div>

            </div>

        </div>

        )}

    </div>
  )
}

export default AdminTaskDetail