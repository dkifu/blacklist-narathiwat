import { useState } from 'react'
import {
  ArrowLeft,
  Cctv,
  ChevronRight,
} from 'lucide-react'

import DailyCctvReport from './daily/DailyCctvReport'
import AlertReport from './daily/AlertReport'
import './DailyReport.css'


function DailyReport({ profile }) {

  const [activeReport, setActiveReport] =
    useState(null)


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

            กลับไปหน้ารายงานประจำวัน
          </button>

          <div className="daily-hub-current-report">

            <Cctv size={18} />

            <span>
              รายงานสถานะระบบ CCTV
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

            กลับไปหน้ารายงานประจำวัน
            </button>


            <div className="daily-hub-current-report">

            <span>
                VSS05
            </span>

            <span>
                รายงานการแจ้งเตือน
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
              เลือกรายงานที่ต้องการ
            </h2>

          </div>

          <small>
            DAILY REPORT CENTER
          </small>

        </div>


        <div className="daily-hub-grid">

          {/* =====================
              CCTV REPORT
          ====================== */}

          <button
            type="button"
            className="daily-hub-card"
            onClick={() =>
              setActiveReport('cctv')
            }
          >

            <div className="daily-hub-card-icon">

              <Cctv size={30} />

            </div>


            <div className="daily-hub-card-content">

              <span className="daily-hub-card-number">
                VSS03
              </span>

              <h3>
                รายงานสถานะระบบ CCTV
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


          {/* =====================
              FUTURE REPORT
          ====================== */}

          {/* =====================
            VSS05 ALERT REPORT
        ====================== */}

        <button
        type="button"
        className="daily-hub-card"
        onClick={() =>
            setActiveReport('alert')
        }
        >

        <div className="daily-hub-card-number-box">
            02
        </div>


        <div className="daily-hub-card-content">

            <span className="daily-hub-card-number">
            VSS05
            </span>

            <h3>
            รายงานการแจ้งเตือน
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

      </section>

    </div>

  )

}


export default DailyReport