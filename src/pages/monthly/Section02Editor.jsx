import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import * as XLSX from 'xlsx'
import { toPng } from 'html-to-image'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'


import { supabase } from '../../lib/supabase'

import './Section02Editor.css'

const EXCEL_HEADERS = [
  'ลำดับ',
  'วันที่ข้อมูล',
  'เวลา',
  'เจ้าหน้าที่ Operator',
  'ประเภทเหตุ',
  'วันที่เกิดเหตุ',
  'เวลาเกิดเหตุ',
  'ที่มา alarm',
  'IP Address',
  'Lat',
  'Long',
]

const THAI_MONTHS = [
  '',
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
]

const CENTER_STATION_MAP = {
  'ศูนย์ตากใบ': 'สภ.ตากใบ',
  'ศูนย์นราธิวาส': 'สภ.เมืองนราธิวาส',
  'ศูนย์สุไหงโกลก': 'สภ.สุไหงโกลก',
  'ศูนย์ปัตตานี': 'สภ.ปัตตานี',
  'ศูนย์หาดใหญ่': 'สภ.หาดใหญ่',
  'ศูนย์เบตง': 'สภ.เบตง',
  'ศูนย์ศชต.': 'ศูนย์ปฏิบัติการสำนักงานตำรวจแห่งชาติส่วนหน้า',
}

const getCenterReportLabel = (center) => {
  const centerName = center?.name || '-'
  const stationName = CENTER_STATION_MAP[centerName]

  return stationName
    ? `${centerName} ${stationName}`
    : centerName
}

const getCategoryColor = (name, index = 0) => {
  const text = String(name || '').toLowerCase()

  // เหตุรุนแรง / ความไม่สงบ
  if (
    text.includes('รุนแรง') ||
    text.includes('ความไม่สงบ')
  ) {
    return '#e21f36'
  }

  // LPR / IVA
  if (
    text.includes('lpr') ||
    text.includes('iva')
  ) {
    return '#1769aa'
  }

  // อาชญากรรม
  if (text.includes('อาชญากรรม')) {
    return '#1ca56b'
  }

  // อุบัติเหตุ
  if (text.includes('อุบัติเหตุ')) {
    return '#f4bd16'
  }

  const fallbackColors = [
    '#8f1730',
    '#7654a8',
    '#da6b2d',
    '#447c92',
    '#7c8b3a',
  ]

  return fallbackColors[
    index % fallbackColors.length
  ]
}

const getMarkerZIndex = (name) => {
  const text =
    String(name || '').toLowerCase()

  // 1. เหตุความไม่สงบ = สูงสุด
  if (
    text.includes('รุนแรง') ||
    text.includes('ความไม่สงบ')
  ) {
    return 4000
  }

  // 2. LPR / IVA
  if (
    text.includes('lpr') ||
    text.includes('iva')
  ) {
    return 3000
  }

  // 3. อาชญากรรม
  if (
    text.includes('อาชญากรรม')
  ) {
    return 2000
  }

  // 4. อุบัติเหตุ
  if (
    text.includes('อุบัติเหตุ')
  ) {
    return 1000
  }

  return 0
}

const formatExcelValue = (value) => {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const normalizeEventDate = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return ''
  }

  // กรณี XLSX ส่งมาเป็น Date
  if (value instanceof Date) {
    const day = value.getDate()
    const month = value.getMonth() + 1
    const rawYear = value.getFullYear()

    // ถ้า Excel เก็บ 2569 มาแล้ว ไม่ต้อง +543 ซ้ำ
    const year =
      rawYear >= 2400
        ? rawYear
        : rawYear + 543

    return `${day}/${month}/${year}`
  }

  // กรณี Excel ส่งมาเป็น serial number
  if (typeof value === 'number') {
    const parsed =
      XLSX.SSF.parse_date_code(value)

    if (parsed) {
      const year =
        parsed.y >= 2400
          ? parsed.y
          : parsed.y + 543

      return `${parsed.d}/${parsed.m}/${year}`
    }
  }

  const text = String(value).trim()

  // เผื่อ serial กลายเป็น string เช่น "244593"
  if (/^\d+(\.\d+)?$/.test(text)) {
    const numberValue = Number(text)

    if (numberValue > 20000) {
      const parsed =
        XLSX.SSF.parse_date_code(
          numberValue
        )

      if (parsed) {
        const year =
          parsed.y >= 2400
            ? parsed.y
            : parsed.y + 543

        return `${parsed.d}/${parsed.m}/${year}`
      }
    }
  }

  // เช่น 31/8/2569 อยู่แล้ว
  return text
}

const getDayFromThaiDate = (value) => {
  if (!value) return null

  const text = String(value).trim()

  const parts = text.split('/')

  if (parts.length !== 3) return null

  const day = Number(parts[0])

  return Number.isFinite(day)
    ? day
    : null
}

function EventMap({ rows }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current) return
    if (!rows?.length) return

    // =========================
    // REMOVE OLD MAP
    // =========================

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
    }


    // =========================
    // CREATE MAP
    // =========================

    const map = L.map(
      mapRef.current,
      {
        zoomControl: true,
        attributionControl: true,

        // ซูมละเอียด
        zoomSnap: 0.05,
        zoomDelta: 0.05,

        wheelPxPerZoomLevel: 200,
      }
    )

    mapInstanceRef.current = map


    // =========================
    // BASE MAP
    // =========================

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,

        crossOrigin: true,

        attribution:
          '&copy; OpenStreetMap contributors',
      }
    ).addTo(map)


    // =========================
    // SPIDERFY SETTINGS
    // =========================

    // ระยะห่างของหมุดที่ถือว่า
    // ซ้อนหรือเบียดกัน หน่วย Pixel
    const OVERLAP_DISTANCE = 30

    // ระยะกางเริ่มต้น
    const SPIDER_RADIUS = 48

    // เวลาก่อนหุบกลับ
    // ให้มีเวลาขยับเมาส์ไปหาหมุดที่กาง
    const SPIDER_CLOSE_DELAY = 1200


    const markerItems = []

    const bounds = []

    let spiderState = null

    let closeSpiderTimer = null


    // =========================
    // TIMER
    // =========================

    const clearCloseSpiderTimer = () => {
      if (!closeSpiderTimer) return

      window.clearTimeout(
        closeSpiderTimer
      )

      closeSpiderTimer = null
    }


    // =========================
    // CLOSE SPIDER
    // =========================

    const unspiderfy = () => {
      clearCloseSpiderTimer()

      if (!spiderState) return


      spiderState.items.forEach(
        (item) => {

          item.marker.setLatLng(
            item.originalLatLng
          )

          item.marker.setZIndexOffset(
            item.baseZIndex
            )

                const markerElement =
                item.marker.getElement()

                if (markerElement) {
                markerElement.classList.remove(
                    'is-spiderfied'
                )
                }
        }
      )


      spiderState.legs.forEach(
        (leg) => {
          if (map.hasLayer(leg)) {
            map.removeLayer(leg)
          }
        }
      )


      spiderState = null
    }


    const scheduleUnspiderfy = () => {
      clearCloseSpiderTimer()

      closeSpiderTimer =
        window.setTimeout(
          () => {
            unspiderfy()
          },
          SPIDER_CLOSE_DELAY
        )
    }


    // =========================
    // FIND OVERLAPPING MARKERS
    // =========================

    const getNearbyMarkers = (
      hoveredItem
    ) => {

      const centerPoint =
        map.latLngToLayerPoint(
          hoveredItem.originalLatLng
        )


      return markerItems.filter(
        (item) => {

          const point =
            map.latLngToLayerPoint(
              item.originalLatLng
            )


          return (
            centerPoint.distanceTo(
              point
            ) <=
            OVERLAP_DISTANCE
          )
        }
      )
    }


    // =========================
    // SPIDERFY
    // =========================

    const spiderfyMarker = (
      hoveredItem
    ) => {

      clearCloseSpiderTimer()


      // ถ้าหมุดนี้อยู่ในชุดที่
      // กางอยู่แล้ว ไม่ต้องสร้างใหม่
      if (
        spiderState?.items.includes(
          hoveredItem
        )
      ) {
        return
      }


      // ปิดกลุ่มเดิมก่อน
      unspiderfy()


      const nearbyItems =
        getNearbyMarkers(
          hoveredItem
        )


      // ไม่มีหมุดทับกัน
      if (nearbyItems.length <= 1) {
        return
      }


      // =========================
      // หาจุดกึ่งกลางของกลุ่ม
      // =========================

      const points =
        nearbyItems.map(
          (item) =>
            map.latLngToLayerPoint(
              item.originalLatLng
            )
        )


      const centerX =
        points.reduce(
          (sum, point) =>
            sum + point.x,
          0
        ) / points.length


      const centerY =
        points.reduce(
          (sum, point) =>
            sum + point.y,
          0
        ) / points.length


      const centerPoint =
        L.point(
          centerX,
          centerY
        )


      const spiderLegs = []

      const total =
        nearbyItems.length


      // =========================
      // MOVE MARKERS
      // =========================

      nearbyItems.forEach(
        (item, index) => {

          let targetPoint


          // =========================
          // 2 - 8 จุด
          // กางเป็นวงกลม
          // =========================

          if (total <= 8) {

            const angle =
              -Math.PI / 2 +
              (
                index *
                Math.PI *
                2
              ) /
              total


            const radius =
              Math.max(
                SPIDER_RADIUS,
                total * 6
              )


            targetPoint =
              L.point(
                centerPoint.x +
                  Math.cos(angle) *
                    radius,

                centerPoint.y +
                  Math.sin(angle) *
                    radius
              )

          } else {

            // =========================
            // มากกว่า 8 จุด
            // กางแบบเกลียว
            // =========================

            const angle =
              index * 0.78


            const radius =
              34 +
              index * 5


            targetPoint =
              L.point(
                centerPoint.x +
                  Math.cos(angle) *
                    radius,

                centerPoint.y +
                  Math.sin(angle) *
                    radius
              )
          }


          const targetLatLng =
            map.layerPointToLatLng(
              targetPoint
            )


          // =========================
          // เส้นจากพิกัดจริง
          // =========================

         /* const leg =
            L.polyline(
              [
                item.originalLatLng,
                targetLatLng,
              ],
              {
                color: '#7b818a',

                weight: 1.4,

                opacity: 0.7,

                interactive: false,
              }
            ).addTo(map)
         

          spiderLegs.push(
            leg
          )

         */


          // =========================
          // ย้าย Marker
          // =========================

          item.marker.setLatLng(
            targetLatLng
          )


          // ให้อยู่เหนือเส้น
          item.marker.setZIndexOffset(
            10000 +
            item.baseZIndex +
            index
            )

            const markerElement =
            item.marker.getElement()

            if (markerElement) {
            markerElement.classList.add(
                'is-spiderfied'
            )
            }
        }
      )


      spiderState = {
        items: nearbyItems,
        legs: spiderLegs,
      }
    }


    // =========================
    // CREATE MARKERS
    // =========================

    rows.forEach(
      (row, index) => {

        const lat =
          row.latNumber

        const long =
          row.longNumber


        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(long)
        ) {
          return
        }


        const color =
          getCategoryColor(
            row.eventType,
            index
          )

        const markerZIndex =
            getMarkerZIndex(
                row.eventType
        )  


        // =========================
        // ICON
        // =========================

        const markerIcon =
          L.divIcon({
            className:
              'section02-map-marker-wrapper',

            html: `
              <div
                class="section02-map-marker"
                style="
                  --marker-color:${color}
                "
              >
                <span></span>
              </div>
            `,

            iconSize: [28, 36],

            iconAnchor: [14, 34],

            popupAnchor: [0, -32],
          })


        const originalLatLng =
          L.latLng(
            lat,
            long
          )


        // =========================
        // MARKER
        // =========================

        const marker =
            L.marker(
                originalLatLng,
                {
                icon: markerIcon,

                zIndexOffset:
                    markerZIndex,

                riseOnHover: true,
                }
            ).addTo(map)


        const markerItem = {
            marker,
            originalLatLng,
            row,
            index,

            baseZIndex:
                markerZIndex,
        }


        markerItems.push(
          markerItem
        )


        // =========================
        // POPUP
        // =========================

        const popup =
          document.createElement(
            'div'
          )


        popup.className =
          'section02-map-popup'


        const title =
          document.createElement(
            'strong'
          )


        title.textContent =
          row.eventType ||
          'ไม่ระบุประเภท'


        const date =
          document.createElement(
            'span'
          )


        date.textContent =
          `วันที่เกิดเหตุ: ${
            row.eventDate || '-'
          }`


        const time =
          document.createElement(
            'span'
          )


        time.textContent =
          `เวลา: ${
            row.eventTime || '-'
          }`


        const coordinate =
          document.createElement(
            'small'
          )


        coordinate.textContent =
          `${lat.toFixed(6)}, ${long.toFixed(6)}`


        popup.appendChild(
          title
        )

        popup.appendChild(
          date
        )

        popup.appendChild(
          time
        )

        popup.appendChild(
          coordinate
        )


        marker.bindPopup(
          popup
        )


        // =========================
        // HOVER = SPIDERFY
        // =========================

        marker.on(
          'mouseover',
          () => {

            clearCloseSpiderTimer()

            spiderfyMarker(
              markerItem
            )
          }
        )


        marker.on(
          'mouseout',
          () => {

            if (spiderState) {
              scheduleUnspiderfy()
            }
          }
        )


        // เมื่อเปิด Popup
        // อย่าเพิ่งหุบ
        marker.on(
          'popupopen',
          () => {
            clearCloseSpiderTimer()
          }
        )


        marker.on(
          'popupclose',
          () => {

            if (spiderState) {
              scheduleUnspiderfy()
            }
          }
        )


        bounds.push(
          originalLatLng
        )
      }
    )


    // =========================
    // MAP EVENTS
    // =========================

    map.on(
      'dragstart',
      unspiderfy
    )


    map.on(
      'zoomstart',
      unspiderfy
    )


    map.on(
      'click',
      () => {

        if (spiderState) {
          scheduleUnspiderfy()
        }
      }
    )


    // =========================
    // AUTO ZOOM
    // =========================

    if (bounds.length === 1) {

      map.setView(
        bounds[0],
        15
      )

    } else if (bounds.length > 1) {

      map.fitBounds(
        bounds,
        {
          padding: [35, 35],

          maxZoom: 15,
        }
      )
    }


    requestAnimationFrame(
      () => {
        map.invalidateSize()
      }
    )


    // =========================
    // CLEANUP
    // =========================

    return () => {

      clearCloseSpiderTimer()

      map.remove()

      mapInstanceRef.current =
        null
    }

  }, [rows])


  return (
    <div
      ref={mapRef}
      className="section02-leaflet-map"
    />
  )
}

const Section02Editor = forwardRef(
  function Section02Editor({
    report,
    center,
    month,
    year,
    canEdit,
  }, ref) {
  const fileInputRef = useRef(null)



  const previewRef = useRef(null)
  const pageRef = useRef(null)

  const [previewScale, setPreviewScale] = useState(1)

  const [rows, setRows] = useState([])
  const [rowsPerPage, setRowsPerPage] = useState(14)
  const [previewPage, setPreviewPage] = useState(0)
  const [message, setMessage] = useState('')

  const [messageType, setMessageType] =
    useState('')

  const [sectionLoading, setSectionLoading] =
    useState(true)

  const [sectionSaving, setSectionSaving] =
    useState(false)  

    // =========================
    // SAVE SECTION 02
    // =========================

    const saveSectionData = async (
    nextRows,
    nextRowsPerPage
    ) => {
    if (!report?.id) {
        setMessage(
        'ไม่พบ Report ID สำหรับบันทึกข้อมูล'
        )
        setMessageType('error')
        return false
    }

    if (!canEdit) {
        setMessage(
        'บัญชีนี้ไม่มีสิทธิ์แก้ไขรายงานของศูนย์นี้'
        )
        setMessageType('error')
        return false
    }

    setSectionSaving(true)

    try {
        const { error } = await supabase
        .from('monthly_report_sections')
        .upsert(
            {
            report_id: report.id,
            section_no: 2,

            content: {
                rows: nextRows,
                rowsPerPage:
                nextRowsPerPage,
            },

            updated_at:
                new Date().toISOString(),
            },
            {
            onConflict:
                'report_id,section_no',
            }
        )

        if (error) {
        console.error(
            'Save Section 02 error:',
            error
        )

        setMessage(
            error.message ||
            'ไม่สามารถบันทึกข้อมูลได้'
        )

        setMessageType('error')

        return false
        }

        return true

    } catch (error) {
        console.error(
        'Save Section 02 error:',
        error
        )

        setMessage(
        'ไม่สามารถบันทึกข้อมูลได้'
        )

        setMessageType('error')

        return false

    } finally {
        setSectionSaving(false)
    }
    }

    // =========================
    // LOAD SECTION 02
    // =========================

    useEffect(() => {
    let cancelled = false

    const loadSectionData = async () => {
        if (!report?.id) {
        setRows([])
        setRowsPerPage(14)
        setSectionLoading(false)
        return
        }

        setSectionLoading(true)

        setRows([])
        setRowsPerPage(14)
        setPreviewPage(0)

        const { data, error } =
        await supabase
            .from(
            'monthly_report_sections'
            )
            .select('content')
            .eq('report_id', report.id)
            .eq('section_no', 2)
            .maybeSingle()

        if (cancelled) return

        if (error) {
        console.error(
            'Load Section 02 error:',
            error
        )

        setMessage(
            'ไม่สามารถโหลดข้อมูลที่บันทึกไว้ได้'
        )

        setMessageType('error')

        setSectionLoading(false)
        return
        }

        if (!data) {
        // ยังไม่เคยบันทึกหัวข้อนี้
        setRows([])
        setRowsPerPage(14)
        setPreviewPage(0)

        setSectionLoading(false)
        return
        }

        const content =
        data.content || {}

        const savedRows =
        Array.isArray(content.rows)
            ? content.rows
            : []

        const rawRowsPerPage =
        Number(content.rowsPerPage)

        const savedRowsPerPage =
        [12, 14, 16].includes(
            rawRowsPerPage
        )
            ? rawRowsPerPage
            : 14

        setRows(savedRows)

        setRowsPerPage(
        savedRowsPerPage
        )

        setPreviewPage(0)

        setMessage(
        `โหลดข้อมูลที่บันทึกไว้ ${savedRows.length} รายการ`
        )

        setMessageType('success')

        setSectionLoading(false)
    }

    loadSectionData()

    return () => {
        cancelled = true
    }
    }, [report?.id])
  

    // =========================
    // AUTO FIT A4 PREVIEW
    // =========================

    useEffect(() => {
    const previewElement =
        previewRef.current

    if (!previewElement) return

    const updatePreviewScale = () => {
        const styles =
        window.getComputedStyle(
            previewElement
        )

        const paddingLeft =
        parseFloat(styles.paddingLeft) || 0

        const paddingRight =
        parseFloat(styles.paddingRight) || 0

        const availableWidth =
        previewElement.clientWidth -
        paddingLeft -
        paddingRight

        const a4Width = 1120

        const nextScale =
        Math.min(
            1,
            availableWidth / a4Width
        )

        setPreviewScale(
        Math.max(0.2, nextScale)
        )
    }

    updatePreviewScale()

    const resizeObserver =
        new ResizeObserver(
        updatePreviewScale
        )

    resizeObserver.observe(
        previewElement
    )

    return () => {
        resizeObserver.disconnect()
    }
    }, [])

  // =========================
  // แบ่งหน้าตารางอัตโนมัติ
  // =========================

  const tablePages = useMemo(() => {
    const pages = []

    for (
      let i = 0;
      i < rows.length;
      i += rowsPerPage
    ) {
      pages.push(
        rows.slice(i, i + rowsPerPage)
      )
    }

    return pages
  }, [rows, rowsPerPage])

  // หน้า 0 = Summary
  // หน้า 1... = ตาราง

  const summary = useMemo(() => {
    const categoryCounts = {}

    const timeCounts = {
        morning: 0,
        evening: 0,
        night: 0,
    }

    const dateCounts = {}

    rows.forEach((row) => {
        // =========================
        // ประเภทเหตุ
        // =========================

        const category =
        row.eventType?.trim() ||
        'ไม่ระบุประเภท'

        categoryCounts[category] =
        (categoryCounts[category] || 0) + 1


        // =========================
        // วันเกิดเหตุ
        // =========================

        if (row.eventDate) {
        dateCounts[row.eventDate] =
            (dateCounts[row.eventDate] || 0) + 1
        }


        // =========================
        // ช่วงเวลา
        // =========================

        const time =
        String(row.eventTime || '').trim()

        const hour =
        Number(time.split(':')[0])

        if (!Number.isNaN(hour)) {
        if (hour >= 8 && hour < 16) {
            timeCounts.morning += 1
        } else if (hour >= 16) {
            timeCounts.evening += 1
        } else {
            timeCounts.night += 1
        }
        }
    })


    const categories =
        Object.entries(categoryCounts)
        .map(([name, count]) => ({
            name,
            count,
            percent:
            rows.length > 0
                ? (count / rows.length) * 100
                : 0,
        }))
        .sort(
            (a, b) =>
            b.count - a.count
        )


    const dates =
        Object.entries(dateCounts)
        .sort(
            (a, b) =>
            b[1] - a[1]
        )


    const topDate =
        dates.length > 0
        ? {
            date: dates[0][0],
            count: dates[0][1],
            }
        : null


    const topCategory =
        categories.length > 0
        ? categories[0]
        : null


    const timeGroups = [
        {
        id: 'morning',
        label: 'กะที่ 1',
        time: '08:00 - 16:00',
        count: timeCounts.morning,
        },
        {
        id: 'evening',
        label: 'กะที่ 2',
        time: '16:00 - 00:00',
        count: timeCounts.evening,
        },
        {
        id: 'night',
        label: 'กะที่ 3',
        time: '00:00 - 08:00',
        count: timeCounts.night,
        },
    ]


    const topTime =
        [...timeGroups].sort(
        (a, b) =>
            b.count - a.count
        )[0]


    return {
        total: rows.length,

        activeDays:
        Object.keys(dateCounts).length,

        categories,

        timeGroups,

        topDate,

        topCategory,

        topTime,

        dateCounts,
    }
    }, [rows])


  const donutGradient = useMemo(() => {
    if (
        summary.total === 0 ||
        summary.categories.length === 0
    ) {
        return '#edf0f3'
    }

    let start = 0

    const segments =
        summary.categories.map(
        (item, index) => {
            const end =
            start + item.percent

            const color =
            getCategoryColor(
                item.name,
                index
            )

            const segment =
            `${color} ${start}% ${end}%`

            start = end

            return segment
        }
        )

    return `conic-gradient(${segments.join(', ')})`
    }, [
    summary.total,
    summary.categories,
    ])  

    const maxTimeCount = useMemo(() => {
        return Math.max(
            ...summary.timeGroups.map(
            (item) => item.count
            ),
            1
        )
    }, [summary.timeGroups])

    const calendarData = useMemo(() => {
        const gregorianYear = year - 543

        const daysInMonth =
            new Date(
            gregorianYear,
            month,
            0
            ).getDate()

        const firstDay =
            new Date(
            gregorianYear,
            month - 1,
            1
            ).getDay()

        const countsByDay = {}

        Object.entries(
            summary.dateCounts
        ).forEach(([date, count]) => {
            const parts =
            String(date).split('/')

            if (parts.length !== 3) {
            return
            }

            const day =
            Number(parts[0])

            const dateMonth =
            Number(parts[1])

            const dateYear =
            Number(parts[2])

            if (
            dateMonth === month &&
            dateYear === year
            ) {
            countsByDay[day] = count
            }
        })

        const maxCount =
            Math.max(
            ...Object.values(
                countsByDay
            ),
            1
            )

        const cells = []

        // ช่องว่างก่อนวันที่ 1
        for (
            let i = 0;
            i < firstDay;
            i += 1
        ) {
            cells.push({
            empty: true,
            key: `empty-${i}`,
            })
        }

        // วันที่จริง
        for (
            let day = 1;
            day <= daysInMonth;
            day += 1
        ) {
            const count =
            countsByDay[day] || 0

            cells.push({
            day,
            count,
            intensity:
                count > 0
                ? count / maxCount
                : 0,
            key: `day-${day}`,
            })
        }

        return {
            cells,
            maxCount,
        }
        }, [
        month,
        year,
        summary.dateCounts,
        ])

    // =========================
    // MAP PAGE DATA
    // =========================

    const mapRows = useMemo(() => {
    return rows
        .map((row, index) => {
        const lat = Number(
            String(row.lat ?? '')
            .trim()
            .replace(',', '.')
        )

        const long = Number(
            String(row.long ?? '')
            .trim()
            .replace(',', '.')
        )

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(long)
        ) {
            return null
        }

        if (
            lat < -90 ||
            lat > 90 ||
            long < -180 ||
            long > 180
        ) {
            return null
        }

        return {
            ...row,

            mapIndex: index,

            latNumber: lat,
            longNumber: long,
        }
        })
        .filter(Boolean)
    }, [rows])


    // มีพิกัดอย่างน้อย 1 จุด
    // จึงสร้างหน้า Map
    const hasMapPage =
    mapRows.length > 0


    // index ของหน้า Map
    // หน้า 0 = Summary
    // หน้า 1... = ตาราง
    // หน้าสุดท้าย = Map
    const mapPageIndex =
    1 + tablePages.length


    const totalPages =
    1 +
    tablePages.length +
    (hasMapPage ? 1 : 0)

  // =========================
  // DOWNLOAD EXCEL TEMPLATE
  // =========================

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new()

    const worksheetData = [
        EXCEL_HEADERS,

        [
            1,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
        ],
    ]
    const worksheet =
      XLSX.utils.aoa_to_sheet(
        worksheetData
      )

    worksheet['!cols'] = [
        { wch: 8 },   // ลำดับ
        { wch: 14 },  // วันที่ข้อมูล
        { wch: 10 },  // เวลา
        { wch: 24 },  // Operator
        { wch: 22 },  // ประเภทเหตุ
        { wch: 14 },  // วันที่เกิดเหตุ
        { wch: 12 },  // เวลาเกิดเหตุ
        { wch: 22 },  // ที่มา alarm
        { wch: 16 },  // IP
        { wch: 16 },  // Lat
        { wch: 16 },  // Long
    ]

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      'ข้อมูลเหตุการณ์'
    )

    // Sheet คำอธิบาย
    const guideData = [
      ['แบบฟอร์มรายงานประจำเดือน'],
      [],
      ['ประเภทเหตุ', 'คำอธิบาย'],
      [
        'เหตุรุนแรง / ความไม่สงบ',
        'เหตุการณ์ด้านความมั่นคงหรือความไม่สงบ',
      ],
      [
        'LPR / IVA',
        'เหตุการณ์ที่ระบบอัจฉริยะตรวจจับได้',
      ],
      [
        'อาชญากรรมทั่วไป',
        'เหตุอาชญากรรมทั่วไป',
      ],
      [
        'อุบัติเหตุ',
        'อุบัติเหตุและเหตุที่เกี่ยวข้อง',
      ],
      [],
      [
        'หมายเหตุ',
        'ห้ามเปลี่ยนชื่อหัวคอลัมน์ใน Sheet ข้อมูลเหตุการณ์',
      ],
      [
        'Lat / Long',
        'ใช้สำหรับสร้างแผนที่ในขั้นตอนถัดไป',
      ],
    ]

    const guideSheet =
      XLSX.utils.aoa_to_sheet(
        guideData
      )

    guideSheet['!cols'] = [
      { wch: 26 },
      { wch: 65 },
    ]

    XLSX.utils.book_append_sheet(
      workbook,
      guideSheet,
      'คำอธิบาย'
    )

    const centerName =
      center?.code ||
      center?.name ||
      'CENTER'

    XLSX.writeFile(
      workbook,
      `Monthly_Report_${centerName}_${month}_${year}.xlsx`
    )
  }

  // =========================
  // UPLOAD EXCEL
  // =========================

  const handleExcelUpload = (event) => {
    const file =
      event.target.files?.[0]

    if (!file) return

    setMessage('')
    setMessageType('')

    const reader = new FileReader()

    reader.onload = async (e) => {
      try {
        const data =
          new Uint8Array(
            e.target.result
          )

        const workbook =
            XLSX.read(data, {
                type: 'array',
                cellDates: true,
        })

        const sheet =
          workbook.Sheets[
            'ข้อมูลเหตุการณ์'
          ] ||
          workbook.Sheets[
            workbook.SheetNames[0]
          ]

        if (!sheet) {
          setMessage(
            'ไม่พบ Sheet ข้อมูลเหตุการณ์'
          )
          return
        }

        const imported =
          XLSX.utils.sheet_to_json(
            sheet,
            {
              defval: '',
            }
          )

        const cleaned =
          imported
            .filter((row) =>
              Object.values(row).some(
                (value) =>
                  String(value).trim() !== ''
              )
            )
            .map((row, index) => ({
              no:
                row['ลำดับ'] ||
                index + 1,

              dataDate:
                normalizeEventDate(
                    row['วันที่ข้อมูล']
                ),

                dataTime:
                formatExcelValue(
                    row['เวลา']
                ),

              operator:
                row[
                  'เจ้าหน้าที่ Operator'
                ] || '',

              eventType:
                row['ประเภทเหตุ'] ||
                '',

              eventDate:
                normalizeEventDate(
                    row['วันที่เกิดเหตุ']
                ),

                eventTime:
                formatExcelValue(
                    row['เวลาเกิดเหตุ']
                ),

              source:
                row['ที่มา alarm'] ||
                '',

              ipAddress:
                row['IP Address'] ||
                '',

              lat:
                row['Lat'] ||
                '',

              long:
                row['Long'] ||
                '',
            }))

        setRows(cleaned)
        setPreviewPage(0)

        const saved =
        await saveSectionData(
            cleaned,
            rowsPerPage
        )

        if (!saved) {
        return
        }

        setMessage(
        `นำเข้าและบันทึกข้อมูลสำเร็จ ${cleaned.length} รายการ`
        )

        setMessageType('success')
      } catch (error) {
        console.error(
            'Excel import error:',
            error
        )

        setRows([])
        setPreviewPage(0)

        setMessage(
            'ไม่สามารถอ่านไฟล์ Excel ได้'
        )

        setMessageType('error')
        }
    }

    reader.readAsArrayBuffer(file)

    // เลือกไฟล์เดิมซ้ำได้
    event.target.value = ''
  }

  

  const waitForPreviewRender = () =>
    new Promise((resolve) => {
        requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
        })
    })


    const captureCurrentPage = async () => {
    const node = pageRef.current

    if (!node) {
        throw new Error(
        'ไม่พบหน้ารายงานสำหรับส่งออก'
        )
    }

    if (document.fonts?.ready) {
        await document.fonts.ready
    }

    return await toPng(node, {
        width: 1120,
        height: 792,

        pixelRatio: 2,

        backgroundColor: '#ffffff',

        cacheBust: true,

        style: {
        width: '1120px',
        height: '792px',

        minWidth: '1120px',
        minHeight: '792px',

        maxWidth: 'none',

        transform: 'none',
        transformOrigin: 'top left',

        position: 'relative',
        top: '0',
        left: '0',

        margin: '0',
        },
    })
    }

    // =========================
    // SAVE CURRENT PAGE AS PNG
    // =========================

    const saveCurrentPageAsImage = async () => {
    const node = pageRef.current

    if (!node) {
        setMessage(
        'ไม่พบหน้ารายงานสำหรับบันทึกภาพ'
        )
        setMessageType('error')
        return
    }

    try {
        setMessage('')
        setMessageType('')

        // รอ Font โหลดให้ครบก่อนสร้างภาพ
        if (document.fonts?.ready) {
        await document.fonts.ready
        }

        const dataUrl = await toPng(
        node,
        {
            width: 1120,
            height: 792,

            // ได้ภาพ 2240 × 1584 px
            // แต่สัดส่วนยังเป็น A4 Landscape
            pixelRatio: 2,

            backgroundColor: '#ffffff',

            cacheBust: true,

            style: {
            width: '1120px',
            height: '792px',

            minWidth: '1120px',
            minHeight: '792px',

            maxWidth: 'none',

            transform: 'none',
            transformOrigin: 'top left',

            position: 'relative',
            top: '0',
            left: '0',

            margin: '0',
            },
        }
        )

        const link =
        document.createElement('a')

        const centerName =
        center?.code ||
        center?.name ||
        'CENTER'

        const pageNumber =
        String(
            previewPage + 1
        ).padStart(2, '0')

        link.download =
        `Monthly_Report_${centerName}_${month}_${year}_Page_${pageNumber}.png`

        link.href = dataUrl

        document.body.appendChild(link)

        link.click()

        document.body.removeChild(link)

        setMessage(
        `บันทึกหน้าที่ ${pageNumber} เป็นภาพเรียบร้อยแล้ว`
        )

        setMessageType('success')

    } catch (error) {
        console.error(
        'Export PNG error:',
        error
        )

        setMessage(
        'ไม่สามารถบันทึกภาพรายงานได้'
        )

        setMessageType('error')
    }
    }

    // =========================
    // PDF EXPORT API
    // =========================

    useImperativeHandle(
    ref,
    () => ({
        isReady: () =>
        !sectionLoading,

        hasData: () =>
        rows.length > 0,

        exportPdfPages: async () => {
        if (
            sectionLoading ||
            rows.length === 0
        ) {
            return []
        }

        const originalPage =
            previewPage

        const pages = []

        try {
            for (
            let pageIndex = 0;
            pageIndex < totalPages;
            pageIndex += 1
            ) {
            setPreviewPage(pageIndex)

            await waitForPreviewRender()

            const dataUrl =
                await captureCurrentPage()

            pages.push({
                sectionNo: 2,
                orientation: 'landscape',
                dataUrl,
            })
            }

            return pages

        } finally {
            setPreviewPage(
            originalPage
            )

            await waitForPreviewRender()
        }
        },
    }),
    [
        sectionLoading,
        rows.length,
        totalPages,
        previewPage,
    ]
    )  

  // =========================
  // RENDER
  // =========================

  return (
    <div className="section02-editor">

      {/* LEFT PANEL */}

      <aside className="section02-panel">

        <div className="section02-panel-head">
          <span>หัวข้อ 02</span>
          <h3>
            รายงานประจำเดือน
          </h3>
          <p>
            นำเข้าข้อมูลและจัดทำ
            Infographic
          </p>
        </div>


        <div className="section02-panel-block">

          <label>
            ข้อมูล Excel
          </label>

          <button
            type="button"
            className="section02-button"
            onClick={downloadTemplate}
          >
            ↓ ดาวน์โหลดแบบฟอร์ม Excel
          </button>

          <button
            type="button"
            className="section02-button primary"

            disabled={
                !canEdit ||
                sectionLoading ||
                sectionSaving
            }

            onClick={() =>
              fileInputRef.current?.click()
            }
          >
            {sectionSaving
                ? 'กำลังบันทึก...'
                : '↑ อัปโหลดข้อมูล Excel'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={handleExcelUpload}
          />

        </div>


        {message && (
            <div
                className={`section02-message ${messageType}`}
            >
                {message}
            </div>
        )}


        <div className="section02-panel-block">

          <label>
            จำนวนรายการ
          </label>

          <strong className="section02-big-value">
            {rows.length}
          </strong>

          <small>
            รายการในเดือนนี้
          </small>

        </div>


        <div className="section02-panel-block">

          <label>
            จำนวนแถวต่อหน้าตาราง
          </label>

          <select
            value={rowsPerPage}

            disabled={
                !canEdit ||
                sectionLoading ||
                sectionSaving
            }

            onChange={async (e) => {
                const nextRowsPerPage =
                    Number(e.target.value)

                setRowsPerPage(
                    nextRowsPerPage
                )

                setPreviewPage(0)

                const saved =
                    await saveSectionData(
                    rows,
                    nextRowsPerPage
                    )

                if (saved) {
                    setMessage(
                    'บันทึกการตั้งค่าหน้าตารางเรียบร้อยแล้ว'
                    )

                    setMessageType('success')
                }
                }}
          >
            <option value={12}>
              12 แถว
            </option>

            <option value={14}>
              14 แถว
            </option>

            <option value={16}>
              16 แถว
            </option>
          </select>

          <small>
            ตารางจะเพิ่ม/ลดหน้า
            อัตโนมัติ
          </small>

        </div>


        <div className="section02-panel-block">

          <label>
            หน้ารายงาน
          </label>

          <button
            className={
              previewPage === 0
                ? 'section02-page-button active'
                : 'section02-page-button'
            }
            onClick={() =>
              setPreviewPage(0)
            }
          >
            01 · หน้าสรุป
          </button>

          {tablePages.map(
            (_, index) => (
              <button
                key={index}
                className={
                  previewPage ===
                  index + 1
                    ? 'section02-page-button active'
                    : 'section02-page-button'
                }
                onClick={() =>
                  setPreviewPage(
                    index + 1
                  )
                }
              >
                {String(
                  index + 2
                ).padStart(2, '0')}
                {' · '}
                ตาราง หน้า {index + 1}
              </button>
            )
          )}

          {hasMapPage && (

            <button
                type="button"

                className={
                previewPage === mapPageIndex
                    ? 'section02-page-button active'
                    : 'section02-page-button'
                }

                onClick={() =>
                setPreviewPage(mapPageIndex)
                }
            >

                {String(
                mapPageIndex + 1
                ).padStart(2, '0')}

                {' · '}

                แผนที่จุดเกิดเหตุ

            </button>

            )}

        </div>

        <div className="section02-panel-block">

            <label>
                ส่งออกรายงาน
            </label>

            <button
                type="button"
                className="section02-button"
                onClick={
                saveCurrentPageAsImage
                }
            >
                ↓ บันทึกหน้าปัจจุบันเป็น PNG
            </button>

            <small>
                บันทึกหน้าที่กำลังเปิดอยู่
                เป็นภาพ A4 แนวนอน
            </small>

            </div>


        <div className="section02-page-summary">
          ทั้งหมด {totalPages} หน้า
          <small>
            หน้าสรุป 1 หน้า +
            ตาราง {tablePages.length} หน้า
            {hasMapPage && (
                <> + แผนที่ 1 หน้า</>
            )}
          </small>
        </div>

      </aside>


      {/* RIGHT PREVIEW */}

      <main
        className="section02-preview"
        ref={previewRef}
        >

        <div
            className="section02-paper-stage"
            style={{
            width:
                1120 * previewScale,
            height:
                792 * previewScale,
            }}
        >

        {previewPage === 0 ? (

          <div
            ref={pageRef}
            className="section02-summary-preview"
            style={{
                transform:
                `scale(${previewScale})`,
            }}
          >

            <span>
              LIVE PREVIEW
            </span>

            <h2>
              รายงานสรุป Heat Map
              ประจำเดือน {THAI_MONTHS[month]} พ.ศ. {year}
            </h2>

            <p>
              {getCenterReportLabel(center)}
              {' · '}
              ประจำเดือน {THAI_MONTHS[month]}
              {' · '}
              พ.ศ. {year}
            </p>

            <div className="section02-infographic">

                <div className="section02-overview-card">

                    <span className="section02-card-label">
                    ภาพรวมเหตุการณ์
                    </span>

                    <strong className="section02-total-number">
                        {summary.total}
                        </strong>

                        <span className="section02-total-label">
                        เหตุการณ์
                        </span>

                    <div className="section02-overview-mini">

                    <div>
                        <small>เกิดเหตุรวม</small>
                        <strong>
                        {summary.activeDays} วัน
                        </strong>
                    </div>

                    <div>
                        <small>ช่วงเวลาสูงสุด</small>
                        <strong>
                        {summary.topTime?.time || '-'}
                        </strong>
                    </div>

                    <div>
                        <small>ประเภทหลัก</small>
                        <strong>
                        {summary.topCategory?.name || '-'}
                        </strong>
                    </div>

                    </div>

                </div>


                <div className="section02-category-card">

                    <span className="section02-card-label">
                        ประเภทเหตุการณ์
                    </span>

                    <div className="section02-category-chart">

                        <div
                        className="section02-donut"
                        style={{
                            background:
                            donutGradient,
                        }}
                        >

                        <div className="section02-donut-center">

                            <strong>
                            {summary.total}
                            </strong>

                            <span>
                            เหตุการณ์
                            </span>

                        </div>

                        </div>


                        <div className="section02-donut-legend">

                        {summary.categories.length > 0 ? (

                            summary.categories.map(
                            (item, index) => (

                                <div
                                    className="section02-donut-legend-row"
                                    key={item.name}
                                    >

                                    <span
                                        className="section02-donut-dot"
                                        style={{
                                        background:
                                            getCategoryColor(
                                            item.name,
                                            index
                                            ),
                                        }}
                                    />

                                    <strong className="section02-donut-label">
                                        {item.name}
                                    </strong>

                                    <span className="section02-donut-count">
                                        {item.count} เหตุการณ์
                                    </span>

                                    <strong className="section02-donut-percent">
                                        {item.percent.toFixed(1)}%
                                    </strong>

                                </div>

                            )
                            )

                        ) : (

                            <div className="section02-donut-empty">
                            ยังไม่มีข้อมูล
                            </div>

                        )}

                        </div>

                    </div>

                    </div>


                <div className="section02-time-card">

                    <span className="section02-card-label">
                        ช่วงเวลาที่เกิดเหตุ
                    </span>

                    <div className="section02-time-chart">

                        {summary.timeGroups.map(
                        (item, index) => {

                            const percent =
                            (item.count / maxTimeCount) * 100

                            return (
                            <div
                                className="section02-time-bar-row"
                                key={item.id}
                            >

                                <div className="section02-time-info">

                                <strong>
                                    {item.label}
                                </strong>

                                <small>
                                    {item.time}
                                </small>

                                </div>


                                <div className="section02-time-track">

                                <div
                                    className={`section02-time-fill time-${index + 1}`}
                                    style={{
                                    width:
                                        `${percent}%`,
                                    }}
                                />

                                </div>


                                <strong className="section02-time-count">
                                {item.count}
                                </strong>

                            </div>
                            )
                        }
                        )}

                    </div>


                    {summary.topTime && (
                        <div className="section02-time-highlight">

                        <span>
                            ช่วงเวลาที่พบเหตุสูงสุด
                        </span>

                        <strong>
                            {summary.topTime.time}
                            {' จำนวน '}
                            {summary.topTime.count} เหตุการณ์
                        </strong>

                        </div>
                    )}

                    </div>


                <div className="section02-calendar-card">

                    <span className="section02-card-label">
                        ปฏิทินวันเกิดเหตุ
                        {' '}
                        ({THAI_MONTHS[month]} {year})
                    </span>

                    <div className="section02-calendar-weekdays">

                        {[
                        'อา',
                        'จ',
                        'อ',
                        'พ',
                        'พฤ',
                        'ศ',
                        'ส',
                        ].map((day) => (
                        <span key={day}>
                            {day}
                        </span>
                        ))}

                    </div>


                    <div className="section02-calendar-grid">

                        {calendarData.cells.map(
                        (cell) => {

                            if (cell.empty) {
                            return (
                                <div
                                key={cell.key}
                                className="section02-calendar-cell empty"
                                />
                            )
                            }

                            const alpha =
                            cell.count > 0
                                ? 0.16 +
                                cell.intensity * 0.72
                                : 0

                            return (
                            <div
                                key={cell.key}
                                className={
                                cell.count > 0
                                    ? 'section02-calendar-cell active'
                                    : 'section02-calendar-cell'
                                }
                                style={
                                cell.count > 0
                                    ? {
                                        background:
                                        `rgba(155, 18, 44, ${alpha})`,
                                    }
                                    : undefined
                                }
                            >

                                <span>
                                {cell.day}
                                </span>

                                {cell.count > 0 && (
                                <small>
                                    {cell.count}
                                </small>
                                )}

                            </div>
                            )
                        }
                        )}

                    </div>


                    <div className="section02-calendar-note">

                        <span>
                        สีเข้ม = จำนวนเหตุการณ์มาก
                        </span>

                        {summary.topDate && (
                        <strong>
                            สูงสุด {summary.topDate.date}
                            {' · '}
                            {summary.topDate.count} เหตุการณ์
                        </strong>
                        )}

                    </div>

                    </div>

                    <div className="section02-insight-card">

                        <span className="section02-card-label">
                            สรุปประเด็นสำคัญ
                        </span>

                        <div className="section02-insight-grid">

                            <div className="section02-insight-row">
                            <strong>01</strong>

                            <span className="section02-insight-text">
                                <span className="section02-insight-line1">
                                {summary.topCategory
                                    ? `${summary.topCategory.name} เป็นเหตุการณ์หลักของเดือน`
                                    : 'ยังไม่มีข้อมูล'}
                                </span>

                                {summary.topCategory && (
                                <span className="section02-insight-line2">
                                    จำนวน {summary.topCategory.count} เหตุการณ์
                                </span>
                                )}
                            </span>
                            </div>


                            <div className="section02-insight-row">
                            <strong>02</strong>

                            <span className="section02-insight-text">
                                <span className="section02-insight-line1">
                                {summary.topTime
                                    ? `พบเหตุสูงสุดในช่วง ${summary.topTime.time}`
                                    : 'ยังไม่มีข้อมูล'}
                                </span>

                                {summary.topTime && (
                                <span className="section02-insight-line2">
                                    จำนวน {summary.topTime.count} เหตุการณ์
                                </span>
                                )}
                            </span>
                            </div>


                            <div className="section02-insight-row">
                            <strong>03</strong>

                            <span className="section02-insight-text">
                                <span className="section02-insight-line1">
                                {summary.topDate
                                    ? `วันที่เกิดเหตุสูงสุด ${summary.topDate.date}`
                                    : 'ยังไม่มีข้อมูล'}
                                </span>

                                {summary.topDate && (
                                <span className="section02-insight-line2">
                                    จำนวน {summary.topDate.count} เหตุการณ์
                                </span>
                                )}
                            </span>
                            </div>

                        </div>

                        </div>

                </div>

          </div>

        ) : hasMapPage &&
                previewPage === mapPageIndex ? (

            <div
                ref={pageRef}
                className="section02-map-preview"
                style={{
                transform:
                    `scale(${previewScale})`,
                }}
            >

                <span>
                MAP PREVIEW
                </span>

                <h2>
                แผนที่จุดเกิดเหตุ
                ประจำเดือน {THAI_MONTHS[month]} พ.ศ. {year}
                </h2>

                <p>
                {getCenterReportLabel(center)}
                {' · '}
                ประจำเดือน {THAI_MONTHS[month]}
                {' · '}
                พ.ศ. {year}
                </p>


                <div className="section02-map-content">

                    <div className="section02-map-frame">

                        <EventMap
                        rows={mapRows}
                        />

                    </div>


                    <div className="section02-map-bottom">

                        <div className="section02-map-legend">

                            {summary.categories.map(
                            (item, index) => (

                                <div
                                className="section02-map-legend-item"
                                key={item.name}
                                >

                                <span
                                    className="section02-map-legend-color"
                                    style={{
                                    background:
                                        getCategoryColor(
                                        item.name,
                                        index
                                        ),
                                    }}
                                />

                                <strong>
                                    {item.name}
                                </strong>

                                <small>
                                    {item.count} เหตุการณ์
                                </small>

                                </div>

                            )
                            )}

                        </div>


                        <div className="section02-map-total">

                            <strong>
                            {mapRows.length}
                            </strong>

                            <span>
                            จุดพิกัด
                            </span>

                        </div>

                        </div>

                    </div>

            </div>

            ) : (

          <div
            ref={pageRef}
            className="section02-table-preview"
            style={{
                transform:
                `scale(${previewScale})`,
            }}
          >

            <div className="section02-table-title">
              <span>
                ตารางสรุป Heat Map
              </span>

              <strong>
                หน้า {previewPage}
              </strong>
            </div>

            <div className="section02-table-wrap">

              <table>
                <thead>
                  <tr>
                    <th>ลำดับ</th>
                    <th>วันที่ข้อมูล</th>
                    <th>เวลา</th>
                    <th>
                      เจ้าหน้าที่ Operator
                    </th>
                    <th>ประเภทเหตุ</th>
                    <th>วันที่เกิดเหตุ</th>
                    <th>เวลาเกิดเหตุ</th>
                    <th>ที่มา alarm</th>
                    <th>IP Address</th>
                    <th>Lat</th>
                    <th>Long</th>
                  </tr>
                </thead>

                <tbody>
                  {tablePages[
                    previewPage - 1
                  ]?.map(
                    (row, index) => (
                      <tr key={index}>
                        <td>{row.no}</td>
                        <td>
                          {row.dataDate}
                        </td>
                        <td>
                          {row.dataTime}
                        </td>
                        <td>
                          {row.operator}
                        </td>
                        <td>
                          {row.eventType}
                        </td>
                        <td>
                          {row.eventDate}
                        </td>
                        <td>
                          {row.eventTime}
                        </td>
                        <td>
                          {row.source}
                        </td>
                        <td>
                          {row.ipAddress}
                        </td>
                        <td>
                          {row.lat}
                        </td>
                        <td>
                          {row.long}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>

            </div>

          </div>

        )}

        </div>

      </main>

    </div>
  )
})

export default Section02Editor