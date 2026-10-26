
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './TechnicianRepair.css'

const TEAMS = {
  takbai: 'ชุดช่างตากใบ',
  pattani: 'ชุดช่างปัตตานี',
}

const STATUS = {
  submitted: 'รอรับงาน',
  accepted: 'รับงานแล้ว',
  in_progress: 'กำลังซ่อม',
  completed: 'ซ่อมเสร็จ',
  closed: 'ปิดงานแล้ว',
}

const formatDate = (value) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T12:00:00+07:00`)
        .toLocaleDateString('th-TH', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
    : '-'

export default function TechnicianRepair({ profile }) {
  
    const role = String(profile?.role || '').toLowerCase()

    const isTechnician = role === 'technician'

    const canViewAllTeams =
    role === 'admin' ||
    role === 'supervisor'

    const teamCode = String(
    profile?.repair_team_code || ''
    ).toLowerCase()

    const authorized =
    profile?.active !== false &&
    (
        canViewAllTeams ||
        (
        isTechnician &&
        Boolean(TEAMS[teamCode])
        )
    )


  const [orders, setOrders] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [error, setError] = useState('')
  const [unitError, setUnitError] = useState('')

  const loadOrders = useCallback(async () => {
    if (!authorized) {
      setOrders([])
      setSelectedId(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    
    let query = supabase
    .from('cctv_repair_orders')
    .select(`
        id,
        ticket_no,
        center_name_snapshot,
        team_code,
        report_date,
        status,
        created_at,
        repair_result,
        repair_cause,
        equipment_items,
        technician_names,
        repair_result_saved_at

    `)
    .in('status', [
        'submitted',
        'accepted',
        'in_progress',
        'completed',
        'closed',
    ])

    // ช่างเห็นเฉพาะใบงานชุดตัวเอง
    if (isTechnician) {
    query = query.eq('team_code', teamCode)
    }

    // Admin / Supervisor เห็นทุกชุดช่าง
    const { data, error: queryError } = await query
    .order('created_at', { ascending: false })
    .limit(100)


    if (queryError) {
      setError(queryError.message)
      setOrders([])
      setSelectedId(null)
    } else {
      const items = data || []
      setOrders(items)

      setSelectedId((old) =>
        items.some((x) => String(x.id) === String(old))
          ? old
          : (items[0]?.id ?? null)
      )
    }

    setLoading(false)
  
    }, [authorized, teamCode, isTechnician])


  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  useEffect(() => {
    let cancelled = false

    if (!authorized || !selectedId) {
      setUnits([])
      setUnitError('')
      setLoadingUnits(false)
      return
    }

    const loadUnits = async () => {
      setLoadingUnits(true)
      setUnits([])
      setUnitError('')

      const { data, error: queryError } = await supabase
        .from('cctv_repair_order_units')
        .select(`
          id,
          unit_label,
          down_camera_count,
          camera_snapshot
        `)
        .eq('order_id', selectedId)
        .order('id')

      if (cancelled) return

      if (queryError) {
        setUnitError(queryError.message)
        setUnits([])
      } else {
        setUnits(data || [])
      }

      setLoadingUnits(false)
    }

    loadUnits()

    return () => {
      cancelled = true
    }
  }, [authorized, selectedId])

  const selectedOrder = useMemo(
    () =>
      orders.find(
        (x) => String(x.id) === String(selectedId)
      ) || null,
    [orders, selectedId]
  )

  
    const [resultText, setResultText] = useState('')
    const [causeText, setCauseText] = useState('')
    const [technicianNames, setTechnicianNames] = useState('')
    const [equipmentItems, setEquipmentItems] = useState([])
    const [saving, setSaving] = useState(false)
    const [actionError, setActionError] = useState('')
    const [actionSuccess, setActionSuccess] = useState('')

    // โหลดข้อมูลผลซ่อมเดิม เมื่อเลือกใบงาน
    useEffect(() => {
    setResultText(selectedOrder?.repair_result || '')
    setCauseText(selectedOrder?.repair_cause || '')
    setTechnicianNames(selectedOrder?.technician_names || '')

    setEquipmentItems(
        Array.isArray(selectedOrder?.equipment_items)
        ? selectedOrder.equipment_items.map((item) => ({
            ...item,
            name: String(item.name || ''),
            failed_count:
                item.failed_count ??
                item.damaged_count ??
                item.quantity ??
                0,
            reset_count: item.reset_count ?? 0,
            old_sn: String(item.old_sn || ''),
            new_sn: String(item.new_sn || ''),
            }))
        : []
    )
    }, [selectedOrder])

    useEffect(() => {
    setActionError('')
    setActionSuccess('')
    }, [selectedId])

    const updateEquipment = (index, field, value) => {
    setEquipmentItems((prev) =>
        prev.map((item, i) =>
        i === index
            ? { ...item, [field]: value }
            : item
        )
    )
    }

    // เปลี่ยนสถานะผ่าน RPC
    const changeStatus = async (nextStatus) => {
    if (!isTechnician || !selectedOrder || saving) return
    
    if (hasUnsavedChanges) {
        setActionError(
            'มีข้อมูลผลซ่อมที่ยังไม่ได้บันทึก กรุณากดบันทึกผลการซ่อมก่อนเปลี่ยนสถานะ'
        )
        return
    }


    if (
        nextStatus === 'closed' &&
        !window.confirm(
        'ยืนยันปิดใบงานนี้? เมื่อปิดแล้วจะไม่สามารถแก้ไขผลซ่อมได้'
        )
    ) {
        return
    }

    setSaving(true)
    setActionError('')
    setActionSuccess('')

    try {
        const { error: rpcError } = await supabase.rpc(
        'cctv_repair_technician_set_status',
        {
            p_order_id: selectedOrder.id,
            p_next_status: nextStatus,
        }
        )

        if (rpcError) throw rpcError

        await loadOrders()

        setActionSuccess(
        `เปลี่ยนสถานะเป็น "${STATUS[nextStatus]}" สำเร็จ`
        )
    } catch (err) {
        setActionError(
        err.message || 'ไม่สามารถเปลี่ยนสถานะได้'
        )
    } finally {
        setSaving(false)
    }
    }

    // บันทึกผลซ่อมผ่าน RPC
    const saveResult = async () => {
    if (!isTechnician || !selectedOrder || saving) return

    if (
        !resultText.trim() ||
        !causeText.trim() ||
        !technicianNames.trim()
    ) {
        setActionError(
        'กรุณากรอกผลการซ่อม สาเหตุ และผู้ดำเนินการให้ครบ'
        )
        return
    }

    if (
        equipmentItems.some(
        (item) => !String(item.name || '').trim()
        )
    ) {
        setActionError(
        'กรุณาระบุชื่ออุปกรณ์ให้ครบ หรือลบแถวที่ไม่ต้องการ'
        )
        return
    }

    const normalizedEquipment = equipmentItems.map(
        (item) => ({
        ...item,
        name: String(item.name).trim(),
        failed_count: Number(item.failed_count || 0),
        reset_count: Number(item.reset_count || 0),
        old_sn: String(item.old_sn || '').trim(),
        new_sn: String(item.new_sn || '').trim(),
        })
    )

    if (
        normalizedEquipment.some(
        (item) =>
            !Number.isInteger(item.failed_count) ||
            item.failed_count < 0 ||
            !Number.isInteger(item.reset_count) ||
            item.reset_count < 0
        )
    ) {
        setActionError(
        'จำนวนอุปกรณ์ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป'
        )
        return
    }

    setSaving(true)
    setActionError('')
    setActionSuccess('')

    try {
        const { error: rpcError } = await supabase.rpc(
        'cctv_repair_technician_save_result',
        {
            p_order_id: selectedOrder.id,
            p_repair_result: resultText.trim(),
            p_repair_cause: causeText.trim(),
            p_equipment_items: normalizedEquipment,
            p_technician_names: technicianNames.trim(),
        }
        )

        if (rpcError) throw rpcError

        await loadOrders()
        setActionSuccess('บันทึกผลการซ่อมสำเร็จ')
    } catch (err) {
        setActionError(
        err.message || 'บันทึกผลการซ่อมไม่สำเร็จ'
        )
    } finally {
        setSaving(false)
    }
    }

    const canEditResult =
    isTechnician &&
    ['accepted', 'in_progress', 'completed'].includes(
        selectedOrder?.status
    )

    
    const normalizeEquipmentForCompare = (items) =>
    (Array.isArray(items) ? items : []).map((item) => ({
        name: String(item?.name ?? ''),
        failed_count: Number(
        item?.failed_count ??
        item?.damaged_count ??
        item?.quantity ??
        0
        ),
        reset_count: Number(item?.reset_count ?? 0),
        old_sn: String(item?.old_sn ?? ''),
        new_sn: String(item?.new_sn ?? ''),
    }))

    const hasUnsavedChanges =
    canEditResult &&
    (
        resultText !== (selectedOrder?.repair_result || '') ||
        causeText !== (selectedOrder?.repair_cause || '') ||
        technicianNames !== (selectedOrder?.technician_names || '') ||
        JSON.stringify(
        normalizeEquipmentForCompare(equipmentItems)
        ) !== JSON.stringify(
        normalizeEquipmentForCompare(selectedOrder?.equipment_items)
        )
    )


    const nextStatus = {
    submitted: 'accepted',
    accepted: 'in_progress',
    in_progress: 'completed',
    completed: 'closed',
    }[selectedOrder?.status]

    const nextStatusLabel = {
    accepted: 'รับงาน',
    in_progress: 'เริ่มซ่อม',
    completed: 'ยืนยันซ่อมเสร็จ',
    closed: 'ปิดใบงาน',
    }[nextStatus]


  if (!authorized) {
    return (
      <div className="tech-panel">
        บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้างานซ่อม
        หรือยังไม่ได้กำหนดชุดช่าง
      </div>
    )
  }

  return (
    <div className="tech-page">
      <div className="tech-head">
        <div>
          <div className="tech-kicker">
            CCTV REPAIR WORKSPACE
          </div>

          <h2>งานซ่อม</h2>

          
            <p>
                {canViewAllTeams ? (
                    <>
                    ผู้ดูแลระบบ: {profile.full_name || profile.username}
                    {' · '}
                    แสดงใบงานทุกชุดช่าง
                    </>
                ) : (
                    <>
                    ผู้ปฏิบัติงาน: {profile.full_name || profile.username}
                    {' · '}
                    {TEAMS[teamCode]}
                    </>
                )}
            </p>

        </div>

        <button
          type="button"
          className="tech-refresh"
          onClick={loadOrders}
          disabled={loading}
        >
          รีเฟรชใบงาน
        </button>
      </div>

      <div className="tech-stats">
        <div className="tech-panel">
          <span>ใบงานทั้งหมด</span>
          <strong>{orders.length}</strong>
        </div>

        <div className="tech-panel">
          <span>รอรับงาน / รับงานแล้ว</span>
          <strong>
            {orders.filter((x) =>
              ['submitted', 'accepted'].includes(x.status)
            ).length}
          </strong>
        </div>

        <div className="tech-panel">
          <span>กำลังซ่อม</span>
          <strong>
            {orders.filter((x) =>
              x.status === 'in_progress'
            ).length}
          </strong>
        </div>

        <div className="tech-panel">
          <span>เสร็จสิ้น / ปิดงาน</span>
          <strong>
            {orders.filter((x) =>
              ['completed', 'closed'].includes(x.status)
            ).length}
          </strong>
        </div>
      </div>

      {error && (
        <div className="tech-error">
          โหลดใบงานไม่สำเร็จ: {error}
        </div>
      )}

      <div className="tech-grid">
        <section className="tech-panel">
          <h3>รายการใบแจ้งซ่อม</h3>

          {loading ? (
            <p>กำลังโหลดใบงาน...</p>
          ) : orders.length === 0 ? (
            <p className="tech-muted">
              ยังไม่มีใบงานที่แสดงได้สำหรับชุดช่างนี้
            </p>
          ) : (
            orders.map((order) => (
              <button
                key={order.id}
                type="button"
                className={`tech-order ${
                  String(selectedId) === String(order.id)
                    ? 'selected'
                    : ''
                }`}
                onClick={() => setSelectedId(order.id)}
              >
                <strong>
                  {order.ticket_no || `ใบงาน #${order.id}`}
                </strong>

                
                <span>
                    {order.center_name_snapshot || 'ไม่ระบุศูนย์'}

                    {canViewAllTeams && (
                        <>
                        {' · '}
                        {TEAMS[order.team_code] || 'ไม่ระบุชุดช่าง'}
                        </>
                    )}
                </span>


                <small>
                  {formatDate(order.report_date)}
                  {' · '}
                  {STATUS[order.status] || order.status}
                </small>
              </button>
            ))
          )}
        </section>

        <section className="tech-panel">
          <h3>รายละเอียดใบงาน</h3>

          {!selectedOrder ? (
            <p className="tech-muted">
              เลือกใบงานทางซ้ายเพื่อดูรายละเอียด
            </p>
          ) : (
            <>
              <div className="tech-detail-head">
                <strong>
                  {selectedOrder.ticket_no ||
                    `ใบงาน #${selectedOrder.id}`}
                </strong>

                <span>
                  {STATUS[selectedOrder.status] ||
                    selectedOrder.status}
                </span>
              </div>

              <p className="tech-muted">
                ศูนย์ผู้แจ้ง:{' '}
                {selectedOrder.center_name_snapshot || '-'}
              </p>

              <p className="tech-muted">
                วันที่รายงาน:{' '}
                {formatDate(selectedOrder.report_date)}
              </p>

              <h4>อุปกรณ์ / จุดที่แจ้งซ่อม</h4>

              {unitError && (
                <div className="tech-error">
                  {unitError}
                </div>
              )}

              {loadingUnits ? (
                <p>กำลังโหลดอุปกรณ์...</p>
              ) : units.length === 0 ? (
                <p className="tech-muted">
                  ไม่มีรายการอุปกรณ์ที่แสดงได้
                </p>
              ) : (
                units.map((unit) => (
                  <div className="tech-unit" key={unit.id}>
                    <strong>
                      {unit.unit_label || '-'}
                    </strong>

                    <span>
                      กล้องที่แจ้งดับ{' '}
                      {unit.down_camera_count ?? 0} ตัว
                    </span>

                    {Array.isArray(unit.camera_snapshot) &&
                      unit.camera_snapshot.map((camera, i) => (
                        <small key={i}>
                          {i + 1}.{' '}
                          {camera.name || 'กล้อง'}
                          {' · IP '}
                          {camera.ip || '-'}
                        </small>
                      ))}
                  </div>
                ))
              )}

              
                <div className="tech-workflow">
                <h4>ผลการซ่อมและดำเนินงาน</h4>

                {selectedOrder.repair_result_saved_at && (
                    <p className="tech-muted">
                    มีผลซ่อมที่บันทึกไว้แล้ว
                    </p>
                )}

                {actionError && (
                    <div className="tech-error" role="alert">
                    {actionError}
                    </div>
                )}

                {actionSuccess && (
                    <p className="tech-success" role="status">
                    {actionSuccess}
                    </p>
                )}

                {(canEditResult ||
                    canViewAllTeams ||
                    (isTechnician &&
                    selectedOrder.repair_result_saved_at)) && (
                    <div className="tech-result-form">
                    <label>
                        ผลการซ่อม
                        <textarea
                        rows={3}
                        value={resultText}
                        onChange={(e) =>
                            setResultText(e.target.value)
                        }
                        disabled={!canEditResult || saving}
                        placeholder="ระบุผลการซ่อม"
                        />
                    </label>

                    <label>
                        สาเหตุที่ชำรุด
                        <textarea
                        rows={2}
                        value={causeText}
                        onChange={(e) =>
                            setCauseText(e.target.value)
                        }
                        disabled={!canEditResult || saving}
                        placeholder="ระบุสาเหตุ"
                        />
                    </label>

                    <label>
                        ชื่อผู้ดำเนินการ
                        <input
                        value={technicianNames}
                        onChange={(e) =>
                            setTechnicianNames(e.target.value)
                        }
                        disabled={!canEditResult || saving}
                        placeholder="ชื่อช่างผู้ดำเนินการจริง"
                        />
                    </label>

                    <h4>รายการอุปกรณ์</h4>
                    <p className="tech-muted">
                        หากตรวจแล้วไม่มีอุปกรณ์ชำรุด
                        สามารถเว้นรายการเป็น 0 แถวได้
                    </p>

                    {equipmentItems.map((item, index) => (
                        <div
                        className="tech-equipment-row"
                        key={index}
                        >
                        <label className="tech-equipment-name">
                            ชื่ออุปกรณ์
                            <input
                            value={item.name}
                            disabled={!canEditResult || saving}
                            onChange={(e) =>
                                updateEquipment(
                                index,
                                'name',
                                e.target.value
                                )
                            }
                            placeholder="เช่น PoE Switch"
                            />
                        </label>

                        <label>
                            เสีย (จำนวน)
                            <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.failed_count}
                            disabled={!canEditResult || saving}
                            onChange={(e) =>
                                updateEquipment(
                                index,
                                'failed_count',
                                e.target.value
                                )
                            }
                            />
                        </label>

                        <label>
                            Reset (จำนวน)
                            <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.reset_count}
                            disabled={!canEditResult || saving}
                            onChange={(e) =>
                                updateEquipment(
                                index,
                                'reset_count',
                                e.target.value
                                )
                            }
                            />
                        </label>

                        <label>
                            S/N เสีย
                            <input
                            value={item.old_sn}
                            disabled={!canEditResult || saving}
                            onChange={(e) =>
                                updateEquipment(
                                index,
                                'old_sn',
                                e.target.value
                                )
                            }
                            />
                        </label>

                        <label>
                            S/N ใหม่
                            <input
                            value={item.new_sn}
                            disabled={!canEditResult || saving}
                            onChange={(e) =>
                                updateEquipment(
                                index,
                                'new_sn',
                                e.target.value
                                )
                            }
                            />
                        </label>

                        {canEditResult && (
                            <button
                            type="button"
                            className="tech-remove-equipment"
                            disabled={saving}
                            onClick={() =>
                                setEquipmentItems((prev) =>
                                prev.filter(
                                    (_, i) => i !== index
                                )
                                )
                            }
                            >
                            ลบรายการ
                            </button>
                        )}
                        </div>
                    ))}

                    {canEditResult && (
                        <div className="tech-actions">
                        <button
                            type="button"
                            className="tech-secondary-action"
                            disabled={saving}
                            onClick={() =>
                            setEquipmentItems((prev) => [
                                ...prev,
                                {
                                name: '',
                                failed_count: 0,
                                reset_count: 0,
                                old_sn: '',
                                new_sn: '',
                                },
                            ])
                            }
                        >
                            + เพิ่มรายการอุปกรณ์
                        </button>

                        <button
                            type="button"
                            className="tech-primary-action"
                            disabled={saving}
                            onClick={saveResult}
                        >
                            {saving
                            ? 'กำลังบันทึก...'
                            : 'บันทึกผลการซ่อม'}
                        </button>
                        </div>
                    )}
                    </div>
                )}

                {isTechnician && nextStatus && (
                    <div className="tech-actions">
                    <button
                        type="button"
                        className="tech-primary-action"
                        disabled={saving}
                        onClick={() =>
                        changeStatus(nextStatus)
                        }
                    >
                        {saving
                        ? 'กำลังดำเนินการ...'
                        : nextStatusLabel}
                    </button>

                    {nextStatus === 'completed' && (
                        <small className="tech-muted">
                        ต้องบันทึกผลซ่อมให้ครบก่อน
                        ยืนยันว่าซ่อมเสร็จ
                        </small>
                    )}
                    </div>
                )}

                {selectedOrder.status === 'closed' && (
                    <p className="tech-success">
                    ใบงานนี้ปิดงานแล้ว
                    </p>
                )}

                {canViewAllTeams && (
                    <p className="tech-muted tech-note">
                    Admin/Supervisor สามารถดูรายละเอียด
                    และผลซ่อมของทุกชุดช่างได้
                    แต่ไม่มีสิทธิ์แก้ไขผ่านหน้านี้
                    </p>
                )}
                </div>

            </>
          )}
        </section>
      </div>
    </div>
  )
}
