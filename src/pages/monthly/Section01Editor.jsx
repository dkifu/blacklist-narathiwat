import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import html2canvas from 'html2canvas'

import {
  Building2,
  ImagePlus,
  ShieldCheck,
  Upload,
} from 'lucide-react'

import { supabase } from '../../lib/supabase'
import './Section01Editor.css'


const CENTER_STATION_MAP = {
  'ศูนย์ตากใบ': 'สภ.ตากใบ',
  'ศูนย์นราธิวาส': 'สภ.เมืองนราธิวาส',
  'ศูนย์สุไหงโกลก': 'สภ.สุไหงโกลก',
  'ศูนย์ปัตตานี': 'สภ.ปัตตานี',
  'ศูนย์หาดใหญ่': 'สภ.หาดใหญ่',
  'ศูนย์เบตง': 'สภ.เบตง',
  'ศูนย์ศชต.':
    'ศูนย์ปฏิบัติการสำนักงานตำรวจแห่งชาติส่วนหน้า',
}


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


const createDefaultCover = (center) => {
  const centerName = center?.name || ''

  const stationName =
    CENTER_STATION_MAP[centerName] ||
    centerName ||
    ''

  return {
    reportTitle: 'รายงานประจำเดือน',

    description:
      'รายงานสรุปผลการปฏิบัติงานและการใช้งานระบบกล้องวงจรปิด',

    stationName,

    organizationName: centerName,

    organizationNameEn: '',


    headerNameTh: stationName,

    headerNameEn: 'POLICE CCTV SECURITY CENTER',

    slogan:
      'ดูแลความปลอดภัย เพื่อประชาชน',

    footerLeft:
      'เหตุด่วน เหตุร้าย แจ้ง 191',

    footerCenter: stationName,

    footerRight: '',

    logoPath: '',

    heroImagePath: '',
  }
}


const Section01Editor = forwardRef(
  function Section01Editor({
    report,
    center,
    month,
    year,
    canEdit,
    onDataChange,
  }, ref) {

  const [form, setForm] =
    useState(() =>
      createDefaultCover(center)
    )

  const [logo, setLogo] =
    useState('')

  const [headerLogo, setHeaderLogo] =
    useState('')

  const [uploadingHeaderLogo, setUploadingHeaderLogo] =
    useState(false)  

  const [heroImage, setHeroImage] =
    useState('')

  const [sectionLoading, setSectionLoading] =
    useState(true)

  const [sectionSaving, setSectionSaving] =
    useState(false)

  const [uploadingLogo, setUploadingLogo] =
    useState(false)

  const [uploadingHero, setUploadingHero] =
    useState(false)

  const [message, setMessage] =
    useState('')

  const [messageType, setMessageType] =
    useState('')

  const initializedRef =
    useRef(false)

  const autoSaveReadyRef =
    useRef(false)  

  const coverWrapRef = useRef(null)

  const pageRef = useRef(null)

  const [coverScale, setCoverScale] =
    useState(null)  


  const centerId =
    center?.id
      ? String(center.id)
      : ''


  const monthNumber =
    Number(
      month ||
      report?.month ||
      0
    )


  /*
   * MonthlyReport ของพี่ใช้ปี พ.ศ.
   * อยู่แล้ว แต่เผื่อกรณีได้ ค.ศ. เข้ามา
   */
  const rawYear =
    Number(
      year ||
      report?.year ||
      0
    )

  const thaiYear =
    rawYear > 0 && rawYear < 2400
      ? rawYear + 543
      : rawYear


  const monthName =
    THAI_MONTHS[monthNumber] || ''


  const periodText =
    useMemo(() => {

      return [
        monthName,
        thaiYear
          ? `พ.ศ. ${thaiYear}`
          : '',
      ]
        .filter(Boolean)
        .join(' ')

    }, [
      monthName,
      thaiYear,
    ])


  const blobToDataUrl = (blob) => {

    return new Promise(
      (resolve, reject) => {

        const reader =
          new FileReader()

        reader.onload = () =>
          resolve(reader.result)

        reader.onerror = () =>
          reject(
            new Error(
              'ไม่สามารถอ่านไฟล์รูปได้'
            )
          )

        reader.readAsDataURL(blob)

      }
    )

  }


  const loadStorageImage =
    async (path) => {

      if (!path) {
        return ''
      }

      const {
        data,
        error,
      } = await supabase
        .storage
        .from('center-report-assets')
        .download(path)

      if (error) {
        throw error
      }

      return blobToDataUrl(data)

    }


  const loadCenterLogo =
    async () => {

      if (!centerId) {
        return {
          path: '',
          dataUrl: '',
        }
      }

      

      const {
        data,
        error,
      } = await supabase
        .from('center_report_settings')
        .select('logo_path')
        .eq('center_id', centerId)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (!data?.logo_path) {
        return {
          path: '',
          dataUrl: '',
        }
      }

      const dataUrl =
        await loadStorageImage(
          data.logo_path
        )

      return {
        path: data.logo_path,
        dataUrl,
      }

    }

    const loadHeaderLogo =
  async () => {

    if (!centerId) {
      return {
        path: '',
        dataUrl: '',
      }
    }

    const {
      data,
      error,
    } = await supabase
      .from('center_report_settings')
      .select('header_logo_path')
      .eq('center_id', centerId)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data?.header_logo_path) {
      return {
        path: '',
        dataUrl: '',
      }
    }

    const dataUrl =
      await loadStorageImage(
        data.header_logo_path
      )

    return {
      path: data.header_logo_path,
      dataUrl,
    }
  }


  const loadCurrentSection =
    async () => {

      if (!report?.id) {
        return null
      }

      const {
        data,
        error,
      } = await supabase
        .from('monthly_report_sections')
        .select('content')
        .eq('report_id', report.id)
        .eq('section_no', 1)
        .maybeSingle()

      if (error) {
        throw error
      }

      return data

    }


  const loadLatestCover =
    async () => {

      if (!centerId) {
        return null
      }

      /*
       * หา Report เก่าของศูนย์เดียวกัน
       * แล้วเลือก Section 01 ล่าสุด
       */
      const {
        data: reports,
        error: reportsError,
      } = await supabase
        .from('monthly_reports')
        .select(
          'id, center_id, year, month, created_at'
        )
        .eq('center_id', centerId)
        .neq(
          'id',
          report?.id || 0
        )
        .order(
          'year',
          { ascending: false }
        )
        .order(
          'month',
          { ascending: false }
        )
        .limit(12)

      if (reportsError) {

        console.warn(
          'Load previous monthly reports:',
          reportsError
        )

        return null
      }

      if (!reports?.length) {
        return null
      }

      const reportIds =
        reports.map(
          (item) => item.id
        )

      const {
        data: sections,
        error: sectionsError,
      } = await supabase
        .from('monthly_report_sections')
        .select(
          'report_id, content'
        )
        .eq('section_no', 1)
        .in(
          'report_id',
          reportIds
        )

      if (sectionsError) {
        throw sectionsError
      }

      if (!sections?.length) {
        return null
      }

      for (
        const previousReport
        of reports
      ) {

        const section =
          sections.find(
            (item) =>
              String(item.report_id) ===
              String(previousReport.id)
          )

        if (section?.content) {
          return section.content
        }

      }

      return null

    }


  useEffect(() => {

    let cancelled = false

    const loadSection =
      async () => {

        if (!report?.id) {

          setForm(
            createDefaultCover(center)
          )

          setLogo('')
          setHeaderLogo('')
          setHeroImage('')
          setSectionLoading(false)

          return
        }

        setSectionLoading(true)
        setMessage('')
        setMessageType('')

        initializedRef.current =
          false

        try {

          const defaults =
            createDefaultCover(center)

          const currentSection =
            await loadCurrentSection()

          let nextForm = defaults

          /*
           * ถ้าเดือนปัจจุบันมีข้อมูล
           * ใช้ข้อมูลของเดือนนี้
           */
          if (
            currentSection?.content
          ) {

            nextForm = {
              ...defaults,
              ...currentSection.content,
            }

          } else {

            /*
             * ถ้ายังไม่มี
             * เอาหน้าปกล่าสุดมาเป็นต้นแบบ
             */
            const latestCover =
              await loadLatestCover()

            if (latestCover) {

              nextForm = {
                ...defaults,
                ...latestCover,
              }

            }

          }


          /*
           * LOGO
           */
          let nextLogo = ''

          if (nextForm.logoPath) {

            try {

              nextLogo =
                await loadStorageImage(
                  nextForm.logoPath
                )

            } catch (error) {

              console.warn(
                'Load cover logo:',
                error
              )

            }

          }


          /*
           * ถ้า Cover ยังไม่มี Logo
           * ใช้ Logo ประจำศูนย์
           */
          if (!nextLogo) {

            try {

              const centerLogo =
                await loadCenterLogo()

              if (
                centerLogo.dataUrl
              ) {

                nextLogo =
                  centerLogo.dataUrl

                nextForm = {
                  ...nextForm,
                  logoPath:
                    centerLogo.path,
                }

              }

            } catch (error) {

              console.warn(
                'Load center logo:',
                error
              )

            }

          }


            /*
            * HEADER LOGO ประจำศูนย์
            */
            let nextHeaderLogo = ''

            try {

            const headerLogoData =
                await loadHeaderLogo()

            if (headerLogoData.dataUrl) {
                nextHeaderLogo =
                headerLogoData.dataUrl
            }

            } catch (error) {

            console.warn(
                'Load header logo:',
                error
            )

            }

          /*
           * HERO IMAGE
           */
          let nextHero = ''

          if (
            nextForm.heroImagePath
          ) {

            try {

              nextHero =
                await loadStorageImage(
                  nextForm.heroImagePath
                )

            } catch (error) {

              console.warn(
                'Load cover image:',
                error
              )

            }

          }


          if (cancelled) {
            return
          }

            setForm(nextForm)
            setLogo(nextLogo)
            setHeaderLogo(nextHeaderLogo)
            setHeroImage(nextHero)

          initializedRef.current =
            true

        } catch (error) {

          console.error(
            'Load Section 01 error:',
            error
          )

          if (!cancelled) {

            setMessage(
              error?.message ||
              'ไม่สามารถโหลดหน้าปกได้'
            )

            setMessageType('error')

          }

        } finally {

          if (!cancelled) {
            setSectionLoading(false)
          }

        }

      }


    loadSection()


    return () => {
      cancelled = true
    }

  }, [
    report?.id,
    centerId,
  ])


  useEffect(() => {

    if (
      !initializedRef.current
    ) {
      return
    }

    onDataChange?.({
      ...form,
      reportMonth: monthNumber,
      reportYear: rawYear,
    })

  }, [
    form,
    monthNumber,
    rawYear,
    onDataChange,
  ])


    /*
    * SCALE COVER PREVIEW
    * กระดาษจริงคงที่ 1120 x 792
    * ย่อ/ขยายทั้งแผ่นตามพื้นที่ Preview
    */
    useEffect(() => {

        const wrap = coverWrapRef.current

        if (!wrap) {
            return
        }

        let frameId = null

        const updateScale = () => {

            frameId = requestAnimationFrame(() => {

            const availableWidth =
                wrap.getBoundingClientRect().width

            if (!availableWidth) {
                return
            }

            const nextScale =
                Math.min(
                availableWidth / 1120,
                1
                )

            setCoverScale(nextScale)

            })

        }

        // รอบแรกหลัง browser จัด layout เสร็จ
        updateScale()

        const observer =
            new ResizeObserver(() => {
            updateScale()
            })

        observer.observe(wrap)

        // กันกรณี layout ด้านนอกเพิ่งขยาย/หดหลัง component mount
        window.addEventListener(
            'resize',
            updateScale
        )

        return () => {

            observer.disconnect()

            window.removeEventListener(
            'resize',
            updateScale
            )

            if (frameId) {
            cancelAnimationFrame(frameId)
            }

        }

        }, [canEdit, sectionLoading])

  const changeField =
    (field, value) => {

      if (!canEdit) {
        return
      }

      setForm(
        (prev) => ({
          ...prev,
          [field]: value,
        })
      )

      setMessage('')
      setMessageType('')

    }


  const validateImage = (file, maxSizeMB = 2) => {
    const allowedTypes = [
        'image/png',
        'image/jpeg',
        'image/webp',
    ]

    if (!allowedTypes.includes(file.type)) {
        setMessage(
        'รองรับเฉพาะ PNG, JPG และ WEBP'
        )
        setMessageType('error')
        return false
    }

    if (
        file.size >
        maxSizeMB * 1024 * 1024
    ) {
        setMessage(
        `ขนาดรูปต้องไม่เกิน ${maxSizeMB} MB`
        )
        setMessageType('error')
        return false
    }

    return true
    }


  const uploadImage =
    async (file, path) => {

      const {
        error,
      } = await supabase
        .storage
        .from('center-report-assets')
        .upload(
          path,
          file,
          {
            contentType: file.type,
            upsert: true,
            cacheControl: '3600',
          }
        )

      if (error) {
        throw error
      }

      return path

    }

    const handleHeaderLogoChange =
        async (file) => {

            if (
            !file ||
            !canEdit
            ) {
            return
            }

            if (!centerId) {

            setMessage(
                'ไม่พบข้อมูลศูนย์'
            )

            setMessageType('error')
            return
            }

            if (!validateImage(file)) {
            return
            }

            setUploadingHeaderLogo(true)
            setMessage('')
            setMessageType('')

            try {

            /*
            * Header Logo แยกตามศูนย์
            */
            const headerLogoPath =
                `${centerId}/header-logo`

            await uploadImage(
                file,
                headerLogoPath
            )

            /*
            * บันทึก Path ลง Settings ของศูนย์
            */
            const {
                error: settingError,
            } = await supabase
                .from('center_report_settings')
                .upsert(
                {
                    center_id: centerId,
                    header_logo_path:
                    headerLogoPath,
                    updated_at:
                    new Date()
                        .toISOString(),
                },
                {
                    onConflict: 'center_id',
                }
                )

            if (settingError) {
                throw settingError
            }

            const dataUrl =
                await blobToDataUrl(file)

            setHeaderLogo(dataUrl)

            setMessage(
                'อัปโหลดโลโก้ส่วนหัวเรียบร้อย'
            )

            setMessageType('success')

            } catch (error) {

            console.error(
                'Upload header logo:',
                error
            )

            setMessage(
                error?.message ||
                'ไม่สามารถอัปโหลดโลโก้ส่วนหัวได้'
            )

            setMessageType('error')

            } finally {

            setUploadingHeaderLogo(false)

            }
        }


  const handleLogoChange =
    async (file) => {

      if (
        !file ||
        !canEdit
      ) {
        return
      }

      if (!centerId) {

        setMessage(
          'ไม่พบข้อมูลศูนย์'
        )

        setMessageType('error')

        return
      }

      if (!validateImage(file)) {
        return
      }

      setUploadingLogo(true)
      setMessage('')
      setMessageType('')

      try {

        /*
         * ใช้ Logo เดียวกับ
         * center_report_settings
         */
        const logoPath =
          `${centerId}/logo`

        await uploadImage(
          file,
          logoPath
        )

        const {
          error: settingError,
        } = await supabase
          .from('center_report_settings')
          .upsert(
            {
              center_id: centerId,
              logo_path: logoPath,
              updated_at:
                new Date()
                  .toISOString(),
            },
            {
              onConflict: 'center_id',
            }
          )

        if (settingError) {
          throw settingError
        }

        const dataUrl =
          await blobToDataUrl(file)

        setLogo(dataUrl)

        setForm(
          (prev) => ({
            ...prev,
            logoPath,
          })
        )

        setMessage(
          'อัปโหลดโลโก้เรียบร้อย'
        )

        setMessageType('success')

      } catch (error) {

        console.error(
          'Upload cover logo:',
          error
        )

        setMessage(
          error?.message ||
          'ไม่สามารถอัปโหลดโลโก้ได้'
        )

        setMessageType('error')

      } finally {

        setUploadingLogo(false)

      }

    }


  const handleHeroChange =
    async (file) => {

      if (
        !file ||
        !canEdit
      ) {
        return
      }

      if (!centerId) {

        setMessage(
          'ไม่พบข้อมูลศูนย์'
        )

        setMessageType('error')

        return
      }

      if (!validateImage(file, 10)) {
        return
        }

      setUploadingHero(true)
      setMessage('')
      setMessageType('')

      try {

        /*
         * ภาพล่าสุดของศูนย์
         * เดือนถัดไปสามารถใช้ต่อได้
         */
        const heroPath =
          `${centerId}/monthly-cover`

        await uploadImage(
          file,
          heroPath
        )

        const dataUrl =
          await blobToDataUrl(file)

        setHeroImage(dataUrl)

        setForm(
          (prev) => ({
            ...prev,
            heroImagePath: heroPath,
          })
        )

        setMessage(
          'อัปโหลดภาพหน้าปกเรียบร้อย'
        )

        setMessageType('success')

      } catch (error) {

        console.error(
          'Upload cover image:',
          error
        )

        setMessage(
          error?.message ||
          'ไม่สามารถอัปโหลดภาพหน้าปกได้'
        )

        setMessageType('error')

      } finally {

        setUploadingHero(false)

      }

    }


  const handleSave =
    async () => {

      if (
        !canEdit ||
        !report?.id
      ) {
        return
      }

      setSectionSaving(true)
      setMessage('')
      setMessageType('')

      try {

        /*
         * ไม่เก็บเดือน/ปีใน content
         * เดือนและปีอิง Report ปัจจุบันเสมอ
         */
        const content = {
          ...form,
        }

        const {
          error,
        } = await supabase
          .from('monthly_report_sections')
          .upsert(
            {
              report_id: report.id,
              section_no: 1,
              content,
              updated_at:
                new Date()
                  .toISOString(),
            },
            {
              onConflict:
                'report_id,section_no',
            }
          )

        if (error) {
          throw error
        }

        setMessage(
          'บันทึกหน้าปกเรียบร้อยแล้ว'
        )

        setMessageType('success')

        onDataChange?.({
          ...content,
          reportMonth: monthNumber,
          reportYear: rawYear,
        })

      } catch (error) {

        console.error(
          'Save Section 01:',
          error
        )

        setMessage(
          error?.message ||
          'ไม่สามารถบันทึกหน้าปกได้'
        )

        setMessageType('error')

      } finally {

        setSectionSaving(false)

      }

    }

    /*
    * AUTO SAVE SECTION 01
    * บันทึกหลังผู้ใช้หยุดแก้ไข 1 วินาที
    */
    useEffect(() => {

    if (
        sectionLoading ||
        !canEdit ||
        !report?.id
    ) {
        return
    }

    /*
    * รอบแรกหลังโหลดข้อมูล
    * ยังไม่ต้อง Save
    */
    if (!autoSaveReadyRef.current) {

        autoSaveReadyRef.current = true

        return
    }

    const timer = setTimeout(() => {

        handleSave()

    }, 1000)

    return () => {
        clearTimeout(timer)
    }

    }, [form])

    // =========================
    // EXPORT COVER
    // =========================

    const waitForCoverRender = () =>
    new Promise((resolve) => {
        requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
        })
    })


    const captureCoverPage = async () => {

    const node = pageRef.current

    if (!node) {
        throw new Error(
        'ไม่พบหน้าปกสำหรับส่งออก'
        )
    }

    if (document.fonts?.ready) {
        await document.fonts.ready
    }

    await waitForCoverRender()

    /*
    * หน้า Preview ถูก scale ตามขนาดจอ
    * ตอน Capture ต้องคืนเป็นขนาดจริง 1120x792
    */
    const originalTransform =
        node.style.transform

    const originalTransformOrigin =
        node.style.transformOrigin

    node.style.transform = 'none'
    node.style.transformOrigin =
        'top left'

    const originalCreatePattern =
        CanvasRenderingContext2D.prototype.createPattern

    CanvasRenderingContext2D.prototype.createPattern =
        function (image, repetition) {

            if (
                image instanceof HTMLCanvasElement &&
                (image.width === 0 || image.height === 0)
            ) {

                console.warn(
                    'Fixed zero-size canvas used by html2canvas:',
                    image.width,
                    image.height
                )

                if (image.width === 0) {
                    image.width = 1
                }

                if (image.height === 0) {
                    image.height = 1
                }

            }

            return originalCreatePattern.call(
                this,
                image,
                repetition
            )
        }    

    try {

        const canvas =
        await html2canvas(
            node,
            {
            width: 1120,
            height: 792,

            backgroundColor:
                '#ffffff',

            scale: 2,

            useCORS: true,
            allowTaint: false,

            logging: false,
            imageTimeout: 15000,

            scrollX: 0,
            scrollY: 0,

            windowWidth: 1120,
            windowHeight: 792,
            }
        )

        return canvas.toDataURL(
        'image/png'
        )

    } finally {

        CanvasRenderingContext2D.prototype.createPattern =
        originalCreatePattern      

        node.style.transform =
        originalTransform

        node.style.transformOrigin =
        originalTransformOrigin

    }
    }


    // =========================
    // SAVE COVER AS PNG
    // =========================

    const saveCoverAsPng = async () => {

    try {

        setMessage('')
        setMessageType('')

        const dataUrl =
        await captureCoverPage()

        const link =
        document.createElement('a')

        const centerName =
        center?.code ||
        center?.name ||
        'CENTER'

        link.download =
        `Monthly_Report_${centerName}_${month}_${year}_Cover.png`

        link.href = dataUrl

        document.body.appendChild(link)

        link.click()

        document.body.removeChild(link)

        setMessage(
        'บันทึกหน้าปกเป็น PNG เรียบร้อยแล้ว'
        )

        setMessageType('success')

    } catch (error) {

        console.error(
        'Export cover PNG:',
        error
        )

        setMessage(
        error?.message ||
        'ไม่สามารถบันทึกหน้าปกเป็น PNG ได้'
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

        /*
        * หน้าปกถือว่ามีหน้าเสมอ
        * เมื่อมี Report
        */
        hasData: () =>
        Boolean(report?.id),

        exportPdfPages: async () => {

        if (
            sectionLoading ||
            !report?.id
        ) {
            return []
        }

        await waitForCoverRender()

        const dataUrl =
            await captureCoverPage()

        return [
            {
            sectionNo: 1,
            orientation: 'landscape',
            dataUrl,
            },
        ]
        },

    }),
    [
        sectionLoading,
        report?.id,
    ]
    )


  if (sectionLoading) {

    return (
      <div className="section01-loading">
        กำลังโหลดหน้าปก...
      </div>
    )

  }
  


  return (

    <div
      className={
        canEdit
          ? 'section01-editor is-editing'
          : 'section01-editor is-preview'
      }
    >

      {/* =====================================
          LEFT EDIT PANEL
          แสดงเฉพาะตอนกด "แก้ไขรายงาน"
      ====================================== */}

      {canEdit && (

        <aside className="section01-panel">

          <div className="section01-panel-head">

            <span>
              หัวข้อ 01
            </span>

            <h3>
              หน้าปก
            </h3>

            <p>
              แก้ไขข้อความ รูปภาพ
              และโลโก้ของรายงาน
            </p>

          </div>


          {message && (

            <div
              className={
                `section01-message ${messageType}`
              }
            >
              {message}
            </div>

          )}


          

          <div className="section01-panel-block">

                <label>
                    ชื่อส่วนหัวภาษาไทย
                </label>

                <input
                    className="section01-input"
                    value={form.headerNameTh || ''}
                    placeholder="เช่น สภ.เมืองนราธิวาส"
                    onChange={(e) =>
                    changeField(
                        'headerNameTh',
                        e.target.value
                    )
                    }
                />

                </div>


                <div className="section01-panel-block">

                <label>
                    ชื่อส่วนหัวภาษาอังกฤษ
                </label>

                <input
                    className="section01-input"
                    value={form.headerNameEn || ''}
                    placeholder="เช่น POLICE CCTV SECURITY CENTER"
                    onChange={(e) =>
                    changeField(
                        'headerNameEn',
                        e.target.value
                    )
                    }
                />

            </div>
          


          


          <div className="section01-panel-block">

            <label>
              ชื่อศูนย์
            </label>

            <input
              className="section01-input"
              value={
                form.organizationName
              }
              onChange={(e) =>
                changeField(
                  'organizationName',
                  e.target.value
                )
              }
            />

          </div>


          <div className="section01-panel-block">

            <label>
              ชื่อศูนย์ภาษาอังกฤษ
            </label>

            <input
              className="section01-input"
              value={
                form.organizationNameEn
              }
              placeholder="เว้นว่างได้"
              onChange={(e) =>
                changeField(
                  'organizationNameEn',
                  e.target.value
                )
              }
            />

          </div>


          <div className="section01-panel-block">

            <label>
              คำขวัญ / ข้อความด้านล่าง
            </label>

            <input
              className="section01-input"
              value={form.slogan}
              onChange={(e) =>
                changeField(
                  'slogan',
                  e.target.value
                )
              }
            />

          </div>


          {/* IMAGE */}

          <div className="section01-panel-block">

            <label>
              รูปภาพหน้าปก
            </label>

            
            {/* ===== HEADER LOGO ===== */}

                <div className="section01-upload-row">

                <div className="section01-mini-preview logo">

                    {headerLogo ? (
                    <img
                        src={headerLogo}
                        alt="Header Logo"
                    />
                    ) : (
                    <ShieldCheck size={24} />
                    )}

                </div>

                <div className="section01-upload-info">

                    <strong>
                    โลโก้ตำรวจ
                    </strong>

                    <span>
                    PNG / JPG / WEBP ไม่เกิน 2 MB
                    </span>

                </div>

                </div>

                <label
                className="section01-button"
                style={{ marginTop: '8px', marginBottom: '14px' }}
                >

                <Upload size={15} />

                {uploadingHeaderLogo
                    ? 'กำลังอัปโหลด...'
                    : 'อัปโหลดโลโก้'}

                <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    disabled={uploadingHeaderLogo}
                    onChange={(e) => {

                    const file =
                        e.target.files?.[0]

                    handleHeaderLogoChange(file)

                    e.target.value = ''
                    }}
                />

                </label>


                {/* ===== LOGO ศูนย์เดิม ===== */}




            <div className="section01-upload-row">

              <div className="section01-mini-preview logo">

                {logo ? (

                  <img
                    src={logo}
                    alt="Logo"
                  />

                ) : (

                  <ShieldCheck
                    size={27}
                  />

                )}

              </div>


              <div className="section01-upload-info">

                <strong>
                  โลโก้ศูนย์
                </strong>

                <span>
                  PNG / JPG / WEBP
                  ไม่เกิน 2 MB
                </span>

              </div>

            </div>


            <label className="section01-button">

              <Upload size={15} />

              {uploadingLogo
                ? 'กำลังอัปโหลด...'
                : 'อัปโหลดโลโก้'}

              <input
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                disabled={uploadingLogo}
                onChange={(e) => {

                  const file =
                    e.target
                      .files?.[0]

                  handleLogoChange(file)

                  e.target.value = ''

                }}
              />

            </label>


            <div className="section01-upload-row hero">

              <div className="section01-mini-preview">

                {heroImage ? (

                  <img
                    src={heroImage}
                    alt="ภาพหน้าปก"
                  />

                ) : (

                  <ImagePlus
                    size={27}
                  />

                )}

              </div>


              <div className="section01-upload-info">

                <strong>
                  ภาพหลัก
                </strong>

                <span>
                  เช่น ภาพสถานี
                  หรือภาพศูนย์
                </span>

              </div>

            </div>


            <label className="section01-button">

              <ImagePlus size={15} />

              {uploadingHero
                ? 'กำลังอัปโหลด...'
                : 'อัปโหลดภาพหลัก'}

              <input
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                disabled={uploadingHero}
                onChange={(e) => {

                  const file =
                    e.target
                      .files?.[0]

                  handleHeroChange(file)

                  e.target.value = ''

                }}
              />

            </label>

          </div>


          {/* FOOTER */}

          <div className="section01-panel-block">

            <label>
              ข้อความส่วนท้าย
            </label>

            <input
              className="section01-input"
              value={form.footerLeft}
              placeholder="ด้านซ้าย"
              onChange={(e) =>
                changeField(
                  'footerLeft',
                  e.target.value
                )
              }
            />

            <input
              className="section01-input"
              value={form.footerCenter}
              placeholder="ตรงกลาง"
              onChange={(e) =>
                changeField(
                  'footerCenter',
                  e.target.value
                )
              }
            />

            <input
              className="section01-input"
              value={form.footerRight}
              placeholder="ด้านขวา"
              onChange={(e) =>
                changeField(
                  'footerRight',
                  e.target.value
                )
              }
            />

          </div>


          <div className="section01-panel-block">

            <label>
                ส่งออกรายงาน
            </label>

            <button
                type="button"
                className="section01-export-button"
                onClick={saveCoverAsPng}
            >
                ↓ บันทึกหน้าปกเป็น PNG
            </button>

            <small>
                บันทึกหน้าปกเป็นภาพ
                A4 แนวนอน
            </small>

            </div>

        </aside>

      )}


      {/* =====================================
          PREVIEW
      ====================================== */}

      <main className="section01-preview">

        {canEdit && (

          <div className="section01-preview-head">

            <div>

              <span>
                LIVE PREVIEW
              </span>

              <strong>
                ตัวอย่างหน้าปก
              </strong>

            </div>

            <small>
              A4 Landscape
            </small>

          </div>

        )}


        <div
            ref={coverWrapRef}
            className="section01-page-wrap"
            >
            <div
                className="section01-page-scale"
                style={{
                    width: coverScale
                    ? `${1120 * coverScale}px`
                    : '100%',
                    height: coverScale
                    ? `${792 * coverScale}px`
                    : 'auto',
                    visibility: coverScale
                    ? 'visible'
                    : 'hidden',
                }}
                >
                <div
                    ref={pageRef}
                    className="section01-page section01-modern-cover"
                    style={{
                        transform: `scale(${coverScale})`,
                    }}
                > 


                {/* ===== BACKGROUND DECORATION ===== */}

                <div className="cover-tech-bg" aria-hidden="true">
                    <div className="cover-grid" />
                    <div className="cover-glow cover-glow-a" />
                    <div className="cover-glow cover-glow-b" />

                    <span className="cover-node n1" />
                    <span className="cover-node n2" />
                    <span className="cover-node n3" />
                    <span className="cover-node n4" />

                    <span className="cover-line l1" />
                    <span className="cover-line l2" />
                    <span className="cover-line l3" />
                </div>


                {/* ===== HEADER ===== */}

                <header className="cover-header">

                  <div className="cover-brand">

                    <div className="cover-brand-logo">
                        {headerLogo ? (
                            <img
                            src={headerLogo}
                            alt="Header Logo"
                            />
                        ) : (
                            <ShieldCheck size={42} />
                        )}
                    </div>

                    <div className="cover-brand-copy">

                        <strong>
                            {form.headerNameTh ||
                            form.stationName ||
                            'สถานีตำรวจ'}
                        </strong>

                        <span>
                            {form.headerNameEn ||
                            'POLICE CCTV SECURITY CENTER'}
                        </span>

                    </div>

                  </div>


                    


                    <div className="cover-header-meta">
                    <span>MONTHLY</span>
                    <strong>REPORT</strong>
                    
                    </div>

                </header>


                {/* ===== REPORT TITLE ===== */}

                <section className="cover-title-section">

                    

                    <h1>รายงานประจำเดือน</h1>

                    <div className="cover-title-rule">
                    <span />
                    <i />
                    <span />
                    </div>

                    <div className="cover-fixed-description">
                        <div>
                            รายงานสภาวะและการใช้งาน ของระบบกล้องโทรทัศน์วงจรปิด
                        </div>

                        <div>
                            ตามโครงการติดตั้งระบบป้องกันความปลอดภัยในเขตเมือง ระยะที่ 2 ด้วยระบบกล้องโทรทัศน์ วงจรปิด ( CCTV ) ในพื้นที่ 6 อำเภอ
                        </div>

                        <div className="cover-report-period">
                            ประจำเดือน {periodText}
                        </div>
                    </div>


                    

                </section>


                {/* ===== MAIN SECURITY AREA ===== */}

                <section className="cover-main">

                    <div className="cover-main-head">

                    <div className="cover-main-logo">

                        {logo ? (
                        <img src={logo} alt="Logo" />
                        ) : (
                        <ShieldCheck size={42} />
                        )}

                    </div>

                    <div className="cover-main-name">

                        <strong>
                            {form.organizationName ||
                            form.stationName ||
                            'สถานีตำรวจ'}
                        </strong>

                        {form.organizationNameEn && (
                            <span>
                            {form.organizationNameEn}
                            </span>
                        )}

                    </div>


                    <div className="cover-main-status">
                        <span />
                        SECURITY SYSTEM
                    </div>

                    </div>


                    <div className="cover-security-body">

                    {/* LEFT INFO */}

                    <div className="cover-side-info cover-side-left">

                        <div className="cover-info-code">
                        01
                        </div>

                        <span>SMART SECURITY</span>
                        <strong>CCTV</strong>

                        <p>
                        SURVEILLANCE
                        <br />
                        MONITORING
                        <br />
                        NETWORK
                        </p>

                        <div className="cover-mini-line" />

                        <small>
                        SAFER CITY
                        <br />
                        SAFER COMMUNITY
                        </small>

                    </div>


                    {/* CENTER HERO */}

                    <div className="cover-hero">

                        <div className="cover-radar radar-1" />
                        <div className="cover-radar radar-2" />
                        <div className="cover-radar radar-3" />

                        <div className="cover-radar-cross cross-x" />
                        <div className="cover-radar-cross cross-y" />


                        <div className="cover-orbit orbit-a">
                        <span />
                        </div>

                        <div className="cover-orbit orbit-b">
                        <span />
                        </div>


                        <div className="cover-photo-frame">

                        <div className="cover-photo-inner">

                            {heroImage ? (
                            <img
                                src={heroImage}
                                alt="ภาพหน่วยงาน"
                            />
                            ) : (
                            <div className="cover-photo-placeholder">
                                <Building2 size={55} />
                                <strong>ภาพหน่วยงาน</strong>
                                <span>MAIN FACILITY IMAGE</span>
                            </div>
                            )}

                        </div>

                        </div>


                        

                    </div>


                    {/* RIGHT INFO */}

                    <div className="cover-side-info cover-side-right">

                        <div className="cover-info-code">
                        24/7
                        </div>

                        <span>INTELLIGENT SYSTEM</span>
                        <strong>LPR / AI</strong>

                        <p>
                        VEHICLE
                        <br />
                        ANALYTICS
                        <br />
                        SECURITY
                        </p>

                        <div className="cover-mini-line" />

                        <small>
                        CONNECT
                        <br />
                        MONITOR
                        <br />
                        PROTECT
                        </small>

                    </div>


                    <div className="cover-map-shape" aria-hidden="true" />

                    </div>


                    <div className="cover-slogan">
                    <span />
                    <strong>
                        “{form.slogan}”
                    </strong>
                    <span />
                    </div>

                </section>


                {/* ===== FOOTER ===== */}

                <footer className="cover-footer">

                    <div className="cover-footer-item">
                    <div className="cover-footer-badge">
                        191
                    </div>

                    <div>
                        <small>EMERGENCY / CONTACT</small>
                        <strong>{form.footerLeft}</strong>
                    </div>
                    </div>


                    <div className="cover-footer-center">
                    <small>CCTV NARATHIWAT</small>
                    <strong>{form.footerCenter}</strong>
                    </div>


                    <div className="cover-footer-right">
                    <span className="cover-online-dot" />

                    <div>
                        <small>SECURITY NETWORK</small>
                        <strong>
                        {form.footerRight || 'ONLINE'}
                        </strong>
                    </div>
                    </div>

                </footer>

                </div>

            </div>    







        </div>

      </main>

    </div>

  )

}
)

export default Section01Editor