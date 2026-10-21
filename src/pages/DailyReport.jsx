import { useState } from 'react'

import {
  ArrowLeft,
  Cctv,
  ChevronRight,
  ScanEye,
  LayoutDashboard,
  Sunrise,
  Sun,
  Moon,
  Clock3,
  FileText,
} from 'lucide-react'


import DailyCctvReport from './daily/DailyCctvReport'
import AlertReport from './daily/AlertReport'
import UsageStatisticsReport from './daily/UsageStatisticsReport'
import CctvAiReport from './daily/CctvAiReport'
import CameraStatusReport from './daily/CameraStatusReport'
import './DailyReport.css'

/* =========================================
   DAILY SHIFT GROUPS
========================================= */

const DAILY_SHIFTS = [
  {
    id: 'morning',
    code: 'SHIFT 01',
    title: 'กะเช้า',
    detail: 'รายงานการปฏิบัติงานกะเช้า',
    icon: Sunrise,
  },
  {
    id: 'afternoon',
    code: 'SHIFT 02',
    title: 'กะบ่าย',
    detail: 'รายงานการปฏิบัติงานกะบ่าย',
    icon: Sun,
  },
  {
    id: 'night',
    code: 'SHIFT 03',
    title: 'กะดึก',
    detail: 'รายงานการปฏิบัติงานกะดึก',
    icon: Moon,
  },
]

const DAILY_HOURS = [1, 2, 3, 4]


function DailyReport({ profile }) {

  const [activeReport, setActiveReport] =
    useState(null)

  const [activeShift, setActiveShift] =
    useState(null)

  const [activeHour, setActiveHour] =
    useState(null)

  const selectedShift = DAILY_SHIFTS.find(
    shift => shift.id === activeShift
  )  

  const reportBackLabel =
    selectedShift && activeHour !== null
      ? `กลับไป${selectedShift.title} / ชั่วโมงที่ ${activeHour}`
      : 'กลับไปหน้ารายงานประจำวัน'


  /* =========================
     เปิดรายงานย่อย
  ========================= */

  if (activeReport === 'cctv') {

    return (

      <div className="daily-hub-report-view">

        <div className="daily-hub-backbar">

          <button
            type="button"
            className="daily-hub-back-button"
            onClick={() =>
              setActiveReport(null)
            }
          >
            <ArrowLeft size={18} />
              {reportBackLabel}
          </button>

          <div className="daily-hub-current-report">

            <Cctv size={18} />

            <span>
              รายงานยอดกล้อง/รวม/งานซ่อม สถิติการใช้งาน
            </span>

          </div>

        </div>


        <DailyCctvReport
          profile={profile}
        />

      </div>

    )

  }

  if (activeReport === 'alert') {

    return (

        <div className="daily-hub-report-view">

        <div className="daily-hub-backbar">

            <button
            type="button"
            className="daily-hub-back-button"
            onClick={() =>
                setActiveReport(null)
            }
            >
            <ArrowLeft size={18} />
              {reportBackLabel}
            </button>


            <div className="daily-hub-current-report">

            <span>
                VEHICLE & FACE ALERTS
            </span>

            <span>
                รายงานแจ้งเตือนรถ / แจ้งเตือนใบหน้า
            </span>

            </div>

        </div>


        <AlertReport
            profile={profile}
        />

        </div>

    )

    }

      /* =========================
        USAGE STATISTICS REPORT
      ========================= */

      if (activeReport === 'usage') {

        return (

          <div className="daily-hub-report-view">

            <div className="daily-hub-backbar">

              <button
                type="button"
                className="daily-hub-back-button"
                onClick={() => setActiveReport(null)}
              >
                <ArrowLeft size={18} />
                  {reportBackLabel}
              </button>

              <div className="daily-hub-current-report">
                <span>USAGE STATS</span>
                <span>รายงานสถิติการใช้งานระบบ</span>
              </div>

            </div>

            <UsageStatisticsReport profile={profile} />

          </div>

        )

      }
  

  
      /* =========================
        AI CCTV ANALYSIS
      ========================= */

      if (activeReport === 'cctv-ai') {
        return (
          <div className="daily-hub-report-view">
            <div className="daily-hub-backbar">

              <button
                type="button"
                className="daily-hub-back-button"
                onClick={() => setActiveReport(null)}
              >
                <ArrowLeft size={18} />
                  {reportBackLabel}
              </button>

              <div className="daily-hub-current-report">
                <ScanEye size={18} />
                <span>AI CCTV ANALYSIS</span>
                <span>วิเคราะห์ภาพกล้องวงจรปิด</span>
              </div>

            </div>

            <CctvAiReport profile={profile} />
          </div>
        )
      }
        

  /* =========================
      TCC CHECKPOINT DASHBOARD
    ========================= */

    if (activeReport === 'tcc-dashboard') {
      return (
        <div className="daily-hub-report-view">

          <div className="daily-hub-backbar">

            <button
              type="button"
              className="daily-hub-back-button"
              onClick={() => setActiveReport(null)}
            >
              <ArrowLeft size={18} />
                {reportBackLabel}
            </button>

            <div className="daily-hub-current-report">
              <LayoutDashboard size={18} />
              <span>CHECKPOINT VEHICLE & FACE COUNTS</span>
              <span>รายงานจำนวนรถ/ใบหน้าผ่านด่าน</span>
            </div>

          </div>

          <iframe
            className="daily-hub-tcc-frame"
            src={`${import.meta.env.BASE_URL}TCC_Dashboard_Report.html`}
            title="รายงาน Dashboard ด่านตรวจ"
            loading="lazy"
          />

        </div>
      )
    }

    /* =========================================
      CCTV REQUESTS
    ========================================= */

    if (activeReport === 'view-requests') {
      return (
        <div className="daily-hub-page">

          {/* BACK BUTTON */}

          <div className="daily-hub-backbar">
            <button
              type="button"
              className="daily-hub-back-button"
              onClick={() => setActiveReport(null)}
            >
              <ArrowLeft size={18} />
              กลับไปหน้ารายงานประจำวัน
            </button>

            <div className="daily-hub-current-report">
              <FileText size={18} />
              <span>ข้อมูลใบคำร้องขอดูภาพ</span>
            </div>
          </div>

          {/* HERO */}

          <section className="daily-hub-hero">
            <span className="daily-hub-eyebrow">
              CCTV REQUESTS
            </span>

            <h1>
              ข้อมูลใบคำร้องขอดูภาพ
            </h1>

            <p>
              ระบบจัดการข้อมูลใบคำร้องขอดูภาพ
              จากกล้องวงจรปิด CCTV
            </p>
          </section>

          {/* EMPTY CONTENT */}

          <section className="daily-hub-content">
            <div className="daily-hub-section-head">
              <div>
                <span>REQUEST MANAGEMENT</span>
                <h2>ข้อมูลใบคำร้องขอดูภาพ</h2>
              </div>
            </div>

            <div className="daily-hub-empty-hour">
              <FileText size={36} />

              <h3>ยังไม่มีข้อมูล</h3>

              <p>
                พื้นที่สำหรับพัฒนาระบบจัดการ
                ข้อมูลใบคำร้องขอดูภาพ
              </p>
            </div>
          </section>

        </div>
      )
    }

    /* =========================================
   CAMERA STATUS REPORT
    HOUR 1 - ALL SHIFTS
  ========================================= */

  if (activeReport === 'camera-status') {
    return (
      <div className="daily-hub-report-view">

        <div className="daily-hub-backbar">

          <button
            type="button"
            className="daily-hub-back-button"
            onClick={() => setActiveReport(null)}
          >
            <ArrowLeft size={18} />
            {reportBackLabel}
          </button>

          <div className="daily-hub-current-report">
            <Cctv size={18} />
            <span>รายงานสถานะกล้อง</span>
          </div>

        </div>

        <CameraStatusReport
          profile={profile}
          shift={activeShift}
        />

      </div>
    )
  }

  /* =========================================
    SHIFT / HOUR NAVIGATION
  ========================================= */

  if (selectedShift) {
    return (
      <div className="daily-hub-page">

        <div className="daily-hub-backbar">
          <button
            type="button"
            className="daily-hub-back-button"
            onClick={() => {
              if (activeHour !== null) {
                setActiveHour(null)
              } else {
                setActiveShift(null)
              }
            }}
          >
            <ArrowLeft size={18} />

            {activeHour !== null
              ? `กลับไป${selectedShift.title}`
              : 'กลับไปหน้ารายงานประจำวัน'}
          </button>

          <div className="daily-hub-current-report">
            {selectedShift.title}

            {activeHour !== null &&
              ` / งานชั่วโมงที่ ${activeHour}`}
          </div>
        </div>

        <section className="daily-hub-hero">
          <span className="daily-hub-eyebrow">
            {selectedShift.code}
          </span>

          <h1>
            {activeHour === null
              ? selectedShift.title
              : `${selectedShift.title} / งานชั่วโมงที่ ${activeHour}`}
          </h1>

          <p>
            {activeHour === null
              ? 'เลือกงานชั่วโมงที่ต้องการจัดทำรายงาน'
              : 'พื้นที่สำหรับจัดทำรายงานประจำชั่วโมง'}
          </p>
        </section>

        <section className="daily-hub-content">

          {activeHour === null ? (
            <>
              <div className="daily-hub-section-head">
                <div>
                  <span>HOURLY REPORT</span>
                  <h2>เลือกงานตามชั่วโมง</h2>
                </div>

                <small>
                  {selectedShift.code}
                </small>
              </div>

              <div className="daily-hub-grid">

                {DAILY_HOURS.map(hour => (
                  <button
                    key={hour}
                    type="button"
                    className="daily-hub-card"
                    onClick={() =>
                      setActiveHour(hour)
                    }
                  >
                    <div className="daily-hub-card-number-box">
                      <Clock3 size={27} />
                    </div>

                    <div className="daily-hub-card-content">
                      <span className="daily-hub-card-number">
                        HOUR {String(hour).padStart(2, '0')}
                      </span>

                      <h3>
                        งานชั่วโมงที่ {hour}
                      </h3>

                      <p>
                        รายงานการปฏิบัติงาน
                        {selectedShift.title}
                      </p>
                    </div>

                    <div className="daily-hub-card-arrow">
                      <ChevronRight size={22} />
                    </div>
                  </button>
                ))}

              </div>
            </>
          ) : (
            <>
              <div className="daily-hub-section-head">
                <div>
                  <span>
                    {selectedShift.code} / HOUR {String(activeHour).padStart(2, '0')}
                  </span>

                  <h2>
                    งานชั่วโมงที่ {activeHour}
                  </h2>
                </div>
              </div>

              {activeHour === 1 ? (

                <div className="daily-hub-grid">

                  {/* =====================================
                      CAMERA STATUS REPORT
                      HOUR 1 - ALL SHIFTS
                  ===================================== */}

                  <button
                    type="button"
                    className="daily-hub-card"
                    onClick={() =>
                      setActiveReport('camera-status')
                    }
                  >

                    <div className="daily-hub-card-number-box">
                      01
                    </div>

                    <div className="daily-hub-card-content">

                      <span className="daily-hub-card-number">
                        CAMERA STATUS
                      </span>

                      <h3>
                        รายงานสถานะกล้อง
                      </h3>

                      <p>
                        ตรวจ Ping กล้องทั่วไป / กล้องด่าน
                        พร้อมยืนยันผลและบันทึกประจำกะ
                      </p>

                    </div>

                    <div className="daily-hub-card-arrow">
                      <ChevronRight size={22} />
                    </div>

                  </button>

                </div>

              ) : activeShift === 'morning' && activeHour === 2 ? (

                <div className="daily-hub-grid">

                  {/* ============================
                      VSS03 - CCTV REPORT
                  ============================ */}

                  <button
                    type="button"
                    className="daily-hub-card"
                    onClick={() => setActiveReport('cctv')}
                  >
                    <div className="daily-hub-card-number-box">
                      01
                    </div>

                    <div className="daily-hub-card-content">
                      <span className="daily-hub-card-number">
                        CCTV TOTALS, REPAIRS & USAGE
                      </span>

                      <h3>
                        รายงานยอดกล้อง/รวม/งานซ่อม สถิติการใช้งาน
                      </h3>

                      <p>
                        จัดทำรายงานสถานะกล้องวงจรปิด
                        งานซ่อม สถิติการใช้งาน
                        และเหตุการณ์ประจำวัน
                      </p>
                    </div>

                    <div className="daily-hub-card-arrow">
                      <ChevronRight size={22} />
                    </div>
                  </button>


                  {/* ============================
                      USAGE STATISTICS REPORT
                  ============================ */}

                  <button
                    type="button"
                    className="daily-hub-card"
                    onClick={() => setActiveReport('usage')}
                  >
                    <div className="daily-hub-card-number-box">
                      02
                    </div>

                    <div className="daily-hub-card-content">
                      <span className="daily-hub-card-number">
                        USAGE STATS
                      </span>

                      <h3>
                        รายงานสถิติการใช้งานระบบ
                      </h3>

                      <p>
                        สรุปสถิติการใช้งานรายวัน รายเดือน
                        รายปี และยอดสะสมทั้งหมด
                      </p>
                    </div>

                    <div className="daily-hub-card-arrow">
                      <ChevronRight size={22} />
                    </div>
                  </button>

                </div>

              ) : activeShift === 'morning' && activeHour === 3 ? (

                <div className="daily-hub-grid">

                  {/* ============================
                      VSS05 - ALERT REPORT
                  ============================ */}

                  <button
                    type="button"
                    className="daily-hub-card"
                    onClick={() => setActiveReport('alert')}
                  >
                    <div className="daily-hub-card-number-box">
                      01
                    </div>

                    <div className="daily-hub-card-content">
                      <span className="daily-hub-card-number">
                        VEHICLE & FACE ALERTS
                      </span>

                      <h3>
                        รายงานแจ้งเตือนรถ / แจ้งเตือนใบหน้า
                      </h3>

                      <p>
                        รายงานเหตุการณ์แจ้งเตือนจากระบบ
                        Face ID และ LPR
                      </p>
                    </div>

                    <div className="daily-hub-card-arrow">
                      <ChevronRight size={22} />
                    </div>
                  </button>

                </div>

              ) : activeShift === 'morning' && activeHour === 4 ? (

                <div className="daily-hub-grid">

                  {/* TCC DASHBOARD - MORNING HOUR 4 */}

                  <button
                    type="button"
                    className="daily-hub-card"
                    onClick={() => setActiveReport('tcc-dashboard')}
                  >
                    <div className="daily-hub-card-number-box">
                      01
                    </div>

                    <div className="daily-hub-card-content">

                      <span className="daily-hub-card-number">
                        CHECKPOINT VEHICLE & FACE COUNTS
                      </span>

                      <h3>
                        รายงานจำนวนรถ/ใบหน้าผ่านด่าน
                      </h3>

                      <p>
                        สรุปสถานะกล้อง การแจ้งเตือน Face ID และ LPR
                        สถิติการจราจรขาเข้า–ขาออก
                        พร้อมจัดทำรายงานรูปภาพ PNG
                      </p>

                    </div>

                    <div className="daily-hub-card-arrow">
                      <ChevronRight size={22} />
                    </div>
                  </button>

                </div>

              ) : (

                <div className="daily-hub-empty-hour">
                  <Clock3 size={36} />

                  <h3>
                    ยังไม่มีรายงานในหมวดนี้
                  </h3>

                  <p>
                    พื้นที่นี้เตรียมไว้สำหรับรายงาน
                    {selectedShift.title} ชั่วโมงที่ {activeHour}
                  </p>
                </div>

              )}

            </>
          )}

        </section>
      </div>
    )
}  


  /* =========================
     DAILY REPORT HOME
  ========================= */

  return (

    <div className="daily-hub-page">

      <section className="daily-hub-hero">

        <div>

          <span className="daily-hub-eyebrow">
            DAILY REPORT
          </span>

          <h1>
            รายงานประจำวัน
          </h1>

          <p>
            เลือกประเภทรายงานที่ต้องการจัดทำ
            ระบบจะแยกข้อมูลและรูปแบบรายงาน
            ตามแต่ละหมวดงาน
          </p>

        </div>

      </section>


      <section className="daily-hub-content">

        <div className="daily-hub-section-head">

          <div>

            <span>
              หมวดรายงาน
            </span>

            <h2>
              เลือกกะปฏิบัติงาน
            </h2>

          </div>

          <small>
            DAILY REPORT CENTER
          </small>

        </div>

        {/* =====================================
            SHIFT SELECTION
        ===================================== */}

        <div className="daily-hub-shift-grid">

          {DAILY_SHIFTS.map(shift => {
            const ShiftIcon = shift.icon

            return (
              <button
                key={shift.id}
                type="button"
                className="daily-hub-shift-card"
                onClick={() => {
                  setActiveShift(shift.id)
                  setActiveHour(null)
                }}
              >
                <div className="daily-hub-shift-icon">
                  <ShiftIcon size={30} />
                </div>

                <div className="daily-hub-shift-info">
                  <span>{shift.code}</span>
                  <h3>{shift.title}</h3>
                  <p>{shift.detail}</p>
                </div>

                <ChevronRight
                  className="daily-hub-shift-arrow"
                  size={22}
                />
              </button>
            )
          })}

        </div>

        {/* =====================================
            AI CCTV ANALYSIS - ALL SHIFTS
        ===================================== */}

        <div className="daily-hub-legacy-head">
          <span>งานและเครื่องมือส่วนกลาง</span>
          <p>
            เลือกงานที่ต้องการใช้งาน
            สำหรับการปฏิบัติงานทุกกะ ทุกชั่วโมง
          </p>
        </div>


        <div className="daily-hub-grid">   

          
              {/* =====================
                  AI CCTV ANALYSIS
              ====================== */}

              <button
                type="button"
                className="daily-hub-card"
                onClick={() => setActiveReport('cctv-ai')}
              >
                <div className="daily-hub-card-number-box">
                  <ScanEye size={27} />
                </div>

                <div className="daily-hub-card-content">
                  <span className="daily-hub-card-number">
                    AI CCTV ANALYSIS
                  </span>

                  <h3>
                    วิเคราะห์สถานการณ์จากภาพ CCTV
                  </h3>

                  <p>
                    วิเคราะห์ความเรียบร้อย การจราจร
                    และเหตุการณ์น่าสนใจจากภาพกล้องวงจรปิด
                    พร้อมจัดทำรายงานเสนอผู้บังคับบัญชา
                  </p>
                </div>

                <div className="daily-hub-card-arrow">
                  <ChevronRight size={22} />
                </div>
              </button>

              {/* =====================================
                  CCTV REQUESTS
              ===================================== */}

              <button
                type="button"
                className="daily-hub-card"
                onClick={() => setActiveReport('view-requests')}
              >
                <div className="daily-hub-card-number-box">
                  <FileText size={27} />
                </div>

                <div className="daily-hub-card-content">

                  <span className="daily-hub-card-number">
                    CCTV REQUESTS
                  </span>

                  <h3>
                    ข้อมูลใบคำร้องขอดูภาพ
                  </h3>

                  <p>
                    จัดการและรวบรวมข้อมูลใบคำร้อง
                    ขอดูภาพจากกล้องวงจรปิด CCTV
                  </p>

                </div>

                <div className="daily-hub-card-arrow">
                  <ChevronRight size={22} />
                </div>
              </button>


              </div>


              

           

      </section>

    </div>

  )

}


export default DailyReport