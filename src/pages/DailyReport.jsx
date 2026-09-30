import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  toBlob,
  toJpeg,
  toPng,
} from 'html-to-image'
import './DailyReport.css'
import liff from '@line/liff'

function DailyReport({ profile }) {

  const getLocalToday = () => {

    const now = new Date()

    const year =
        now.getFullYear()

    const month =
        String(
        now.getMonth() + 1
        ).padStart(2, '0')

    const day =
        String(
        now.getDate()
        ).padStart(2, '0')

    return `${year}-${month}-${day}`
    }  

  const isAdmin =
    profile?.role === 'admin'

  const isCenter =
    profile?.role === 'center'

  const [centers, setCenters] =
    useState([])

  const [
    selectedCenterId,
    setSelectedCenterId,
  ] = useState(
    isCenter && profile?.center_id
        ? String(profile.center_id)
        : ''
  )

  const liffId =
    import.meta.env.VITE_LIFF_ID

  const [form, setForm] = useState({
    reportTitle: 'รายงานประจำวัน',
    unitName: 'สภ.เมืองนราธิวาส',
    reportDate:
        getLocalToday(),

    cameraReady: 312,
    cameraBroken: 0,

    avgCameraReady: 307.92,
    avgCameraBroken: 3.36,

    repairTotal: 339,
    repair24: 246,
    repair48: 59,
    repair72: 34,

    dailyUnrest: 0,
    dailyAccident: 0,
    dailyCrime: 0,
    dailySystem: 0,

    totalUnrest: 26,
    totalAccident: 610,
    totalCrime: 153,
    totalSystem: 242,

    cctvTraffic: 610,
    cctvInvestigation: 196,
    cctvPrevention: 225,
  })

  const [logo, setLogo] = useState('')
  const [logoName, setLogoName] = useState('')

  const [isLogoSaving, setIsLogoSaving] =
    useState(false)

  const blobToDataUrl = (blob) => {
    return new Promise(
        (resolve, reject) => {

        const reader =
            new FileReader()

        reader.onload = () => {
            resolve(reader.result)
        }

        reader.onerror = () => {
            reject(
            new Error(
                'ไม่สามารถอ่านไฟล์รูปได้'
            )
            )
        }

        reader.readAsDataURL(blob)
        }
    )
    }  

  const previewAreaRef = useRef(null)
    const previewCanvasRef = useRef(null)

    const [
    previewCanvasHeight,
    setPreviewCanvasHeight,
    ] = useState(675)

    const [previewScale, setPreviewScale] =
    useState(1)

    const [isSavingReport, setIsSavingReport] =
    useState(false)

    const [isReportSaved, setIsReportSaved] =
    useState(false)

    const [savedImageSize, setSavedImageSize] =
    useState(0)

    


    useEffect(() => {

        const updatePreviewScale = () => {

            const area =
            previewAreaRef.current

            const canvas =
            previewCanvasRef.current

            if (!area || !canvas) {
            return
            }


            const styles =
            window.getComputedStyle(area)

            const paddingLeft =
            parseFloat(
                styles.paddingLeft
            ) || 0

            const paddingRight =
            parseFloat(
                styles.paddingRight
            ) || 0


            const availableWidth =
            area.clientWidth -
            paddingLeft -
            paddingRight


            /*
            * ความสูงจริงของ Infographic
            * ไม่บังคับเป็น 675
            */
            const naturalHeight =
            canvas.offsetHeight


            const widthScale =
            availableWidth / 1200


            /*
            * Desktop:
            * พยายามให้เห็นทั้งภาพในจอ
            *
            * Tablet / Mobile:
            * ให้ย่อตามความกว้างอย่างเดียว
            */
            let nextScale =
            Math.min(
                1,
                widthScale
            )


            if (window.innerWidth > 1100) {

            const areaTop =
                area
                .getBoundingClientRect()
                .top

            const availableHeight =
                window.innerHeight -
                areaTop -
                24

            const heightScale =
                availableHeight /
                naturalHeight

            nextScale =
                Math.min(
                1,
                widthScale,
                heightScale
                )
            }


            setPreviewCanvasHeight(
            naturalHeight
            )

            setPreviewScale(
            Math.max(
                0.1,
                nextScale
            )
            )
        }


        requestAnimationFrame(
            updatePreviewScale
        )


        const observer =
            new ResizeObserver(
            updatePreviewScale
            )


        if (previewAreaRef.current) {
            observer.observe(
            previewAreaRef.current
            )
        }


        if (previewCanvasRef.current) {
            observer.observe(
            previewCanvasRef.current
            )
        }


        window.addEventListener(
            'resize',
            updatePreviewScale
        )

        

        


            


        return () => {

            observer.disconnect()

            window.removeEventListener(
            'resize',
            updatePreviewScale
            )

        }

        }, [])

    /*
    * โหลดรายชื่อศูนย์
    */
    useEffect(() => {

    const loadCenters = async () => {

        const { data, error } =
        await supabase
            .from('centers')
            .select(
            'id, name, code, active'
            )
            .eq('active', true)
            .order('name')


        if (error) {

        console.error(
            'Load centers error:',
            error
        )

        return
        }


        setCenters(data || [])
    }


    loadCenters()

    }, [])

  useEffect(() => {

    /*
    * User ศูนย์
    * บังคับใช้ศูนย์ตัวเอง
    */
    if (
        isCenter &&
        profile?.center_id
    ) {

        setSelectedCenterId(
        String(profile.center_id)
        )

    }

    }, [
    isCenter,
    profile?.center_id,
  ])

  const selectedCenter =
    centers.find(
        (center) =>
        String(center.id) ===
        String(selectedCenterId)
  )

  useEffect(() => {

    if (!selectedCenter) {
        return
    }

    setForm((prev) => ({
        ...prev,
        unitName:
        selectedCenter.name || '',
    }))

  }, [selectedCenter])

  useEffect(() => {

    let cancelled = false


    const loadCenterLogo =
        async () => {

        if (!selectedCenterId) {

            setLogo('')
            setLogoName('')

            return
        }


        try {

            /*
            * หา path โลโก้
            * ของศูนย์ที่เลือก
            */
            const {
            data: setting,
            error: settingError,
            } = await supabase
            .from(
                'center_report_settings'
            )
            .select(
                'logo_path'
            )
            .eq(
                'center_id',
                String(
                selectedCenterId
                )
            )
            .maybeSingle()


            if (settingError) {
            throw settingError
            }


            /*
            * ศูนย์นี้ยังไม่มี Logo
            */
            if (!setting?.logo_path) {

            if (!cancelled) {
                setLogo('')
                setLogoName('')
            }

            return
            }


            /*
            * Download จาก Private Storage
            */
            const {
            data: logoBlob,
            error: downloadError,
            } = await supabase
            .storage
            .from(
                'center-report-assets'
            )
            .download(
                setting.logo_path
            )


            if (downloadError) {
            throw downloadError
            }


            /*
            * แปลงกลับเป็น Data URL
            * เพื่อใช้กับ Infographic
            */
            const dataUrl =
            await blobToDataUrl(
                logoBlob
            )


            if (!cancelled) {

            setLogo(dataUrl)

            setLogoName(
                'โลโก้ประจำศูนย์'
            )
            }


        } catch (error) {

            console.error(
            'Load center logo error:',
            error
            )

            if (!cancelled) {
            setLogo('')
            setLogoName('')
            }
        }
        }


    loadCenterLogo()


    return () => {
        cancelled = true
    }

    }, [selectedCenterId])

    useEffect(() => {

        let cancelled = false


        const loadSavedDailyReport =
            async () => {

            if (
                !selectedCenterId ||
                !form.reportDate
            ) {
                return
            }


            try {

                const {
                data,
                error,
                } = await supabase
                .from('daily_reports')
                .select(`
                    report_data,
                    image_path,
                    image_size_bytes
                `)
                .eq(
                    'center_id',
                    String(
                    selectedCenterId
                    )
                )
                .eq(
                    'report_date',
                    form.reportDate
                )
                .maybeSingle()


                if (error) {
                throw error
                }


                /*
                * วันนี้ยังไม่เคยบันทึก
                */
                if (!data) {

                if (!cancelled) {
                    setIsReportSaved(false)
                    setSavedImageSize(0)
                }

                return
                }


                /*
                * โหลดข้อมูลเดิมกลับเข้าฟอร์ม
                */
                if (
                !cancelled &&
                data.report_data
                ) {

                setForm((prev) => ({
                    ...prev,
                    ...data.report_data,

                    /*
                    * ป้องกันวันที่จาก JSON
                    * ไปเปลี่ยนวันที่ที่กำลังเปิดอยู่
                    */
                    reportDate:
                    prev.reportDate,
                }))


                setSavedImageSize(
                    data.image_size_bytes ||
                    0
                )


                setIsReportSaved(
                    Boolean(
                    data.image_path
                    )
                )
                }


            } catch (error) {

                console.error(
                'Load saved daily report error:',
                error
                )
            }
            }


        loadSavedDailyReport()


        return () => {
            cancelled = true
        }

        }, [
        selectedCenterId,
        form.reportDate,
        ])

  const changeField = (
    field,
    value
    ) => {

    setIsReportSaved(false)
    setSavedImageSize(0)

    setForm((prev) => ({
        ...prev,
        [field]: value,
    }))
    }

  const changeNumber = (field, value) => {
    const number = Number(value)

    changeField(
      field,
      Number.isNaN(number)
        ? 0
        : number
    )
  }

  const readLogo = (file, setter) => {
    if (!file) return

    const reader = new FileReader()

    reader.onload = () => {
      setter(reader.result)
    }

    reader.readAsDataURL(file)
  }

  const handleLogoChange =
    async (file) => {

        if (!file) return


        if (!selectedCenterId) {

        alert(
            'กรุณาเลือกศูนย์ก่อนอัปโหลดโลโก้'
        )

        return
        }


        const allowedTypes = [
        'image/png',
        'image/jpeg',
        'image/webp',
        ]


        if (
        !allowedTypes.includes(
            file.type
        )
        ) {

        alert(
            'รองรับเฉพาะ PNG, JPG และ WEBP'
        )

        return
        }


        if (
        file.size >
        2 * 1024 * 1024
        ) {

        alert(
            'ขนาดโลโก้ต้องไม่เกิน 2 MB'
        )

        return
        }


        setIsLogoSaving(true)


        try {

        /*
        * ใช้ path เดิมตลอด
        * จึงไม่เกิดไฟล์ Logo ซ้ำ
        */
        const logoPath =
            `${selectedCenterId}/logo`


        /*
        * Upload / เขียนทับ
        */
        const {
            error: uploadError,
        } = await supabase
            .storage
            .from(
            'center-report-assets'
            )
            .upload(
            logoPath,
            file,
            {
                contentType:
                file.type,

                upsert: true,

                cacheControl:
                '3600',
            }
            )


        if (uploadError) {
            throw uploadError
        }


        /*
        * ผูก Logo กับศูนย์
        */
        const {
            error: settingError,
        } = await supabase
            .from(
            'center_report_settings'
            )
            .upsert(
            {
                center_id:
                String(
                    selectedCenterId
                ),

                logo_path:
                logoPath,

                updated_by:
                profile?.id ||
                null,

                updated_at:
                new Date()
                    .toISOString(),
            },
            {
                onConflict:
                'center_id',
            }
            )


        if (settingError) {
            throw settingError
        }


        /*
        * Preview ทันที
        */
        const dataUrl =
            await blobToDataUrl(
            file
            )

        setLogo(dataUrl)

        setLogoName(
            file.name
        )


        alert(
            'บันทึกโลโก้ประจำศูนย์เรียบร้อยแล้ว'
        )


        } catch (error) {

        console.error(
            'Save center logo error:',
            error
        )

        alert(
            error?.message ||
            'ไม่สามารถบันทึกโลโก้ได้'
        )

        } finally {

        setIsLogoSaving(false)
        }
    }

  const totalCamera = useMemo(
    () =>
      Number(form.cameraReady || 0) +
      Number(form.cameraBroken || 0),
    [
      form.cameraReady,
      form.cameraBroken,
    ]
  )

  const cameraReadyPercent = useMemo(() => {
    if (!totalCamera) return 0

    return Math.round(
      (
        Number(form.cameraReady || 0) /
        totalCamera
      ) * 100
    )
  }, [
    totalCamera,
    form.cameraReady,
  ])

  const averageTotal =
    Number(form.avgCameraReady || 0) +
    Number(form.avgCameraBroken || 0)

  const averageReadyPercent =
    averageTotal > 0
      ? (
          Number(form.avgCameraReady || 0) /
          averageTotal
        ) * 100
      : 0

  const repairPercent = (value) => {
    const total =
      Number(form.repairTotal || 0)

    if (!total) return 0

    return Math.round(
      (
        Number(value || 0) /
        total
      ) * 100
    )
  }

  const dailyEventTotal =
    Number(form.dailyUnrest || 0) +
    Number(form.dailyAccident || 0) +
    Number(form.dailyCrime || 0) +
    Number(form.dailySystem || 0)

  const cumulativeEventTotal =
    Number(form.totalUnrest || 0) +
    Number(form.totalAccident || 0) +
    Number(form.totalCrime || 0) +
    Number(form.totalSystem || 0)

  const formatThaiDate = (dateValue) => {
    if (!dateValue) return '-'

    const date = new Date(
      `${dateValue}T00:00:00`
    )

    return new Intl.DateTimeFormat(
      'th-TH',
      {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }
    ).format(date)
  }

  const MAX_REPORT_IMAGE_BYTES =
    200 * 1024


    const dataUrlToBlob = async (
    dataUrl
    ) => {

    const response =
        await fetch(dataUrl)

    return response.blob()
    }


    const createCompressedReportImage =
    async () => {

        const canvas =
        previewCanvasRef.current

        if (!canvas) {
        throw new Error(
            'ไม่พบพื้นที่รายงาน'
        )
        }


        /*
        * พยายามรักษาความคมก่อน
        * ถ้ายังใหญ่ค่อยลด quality / resolution
        */
        const pixelRatios = [
        1,
        0.9,
        0.8,
        0.7,
        ]

        const qualities = [
        0.82,
        0.72,
        0.62,
        0.52,
        0.42,
        ]


        let smallestBlob = null


        for (
        const pixelRatio of pixelRatios
        ) {

        for (
            const quality of qualities
        ) {

            const dataUrl =
            await toJpeg(
                canvas,
                {
                cacheBust: true,

                pixelRatio,

                quality,

                backgroundColor:
                    '#ffffff',

                style: {
                    transform: 'none',
                    transformOrigin:
                    'top left',
                },
                }
            )


            const blob =
            await dataUrlToBlob(
                dataUrl
            )


            if (
            !smallestBlob ||
            blob.size <
                smallestBlob.size
            ) {
            smallestBlob = blob
            }


            /*
            * ผ่านทันที
            * เมื่อ <= 200 KB
            */
            if (
            blob.size <=
            MAX_REPORT_IMAGE_BYTES
            ) {

            return blob
            }
        }
        }


        throw new Error(
        `ไม่สามารถลดขนาดรูปให้ต่ำกว่า 200 KB ได้ ขนาดต่ำสุด ${
            Math.round(
            (smallestBlob?.size || 0) /
            1024
            )
        } KB`
        )
    }

    const handleSaveReport =
        async () => {

            if (!selectedCenterId) {
            alert(
                'กรุณาเลือกศูนย์ก่อนบันทึก'
            )
            return
            }


            if (!form.reportDate) {
            alert(
                'กรุณาเลือกวันที่รายงาน'
            )
            return
            }


            setIsSavingReport(true)
            setIsReportSaved(false)


            try {

            /*
            * 1. สร้าง JPEG <= 200 KB
            */
            const imageBlob =
                await createCompressedReportImage()


            /*
            * 2. Path คงที่
            * 1 ศูนย์ + 1 วัน = 1 รูป
            */
            const imagePath =
                `${selectedCenterId}/${form.reportDate}.jpg`


            /*
            * 3. Upload Storage
            */
            const {
                error: uploadError,
            } = await supabase
                .storage
                .from('daily-reports')
                .upload(
                imagePath,
                imageBlob,
                {
                    contentType:
                    'image/jpeg',

                    upsert: true,
                }
                )


            if (uploadError) {
                throw uploadError
            }


            /*
            * 4. บันทึกข้อมูลรายงาน
            */
            const {
                error: reportError,
            } = await supabase
                .from('daily_reports')
                .upsert(
                {
                    center_id:
                    String(
                        selectedCenterId
                    ),

                    report_date:
                    form.reportDate,

                    report_title:
                    form.reportTitle,

                    unit_name:
                    form.unitName,

                    report_data:
                    form,

                    image_path:
                    imagePath,

                    image_size_bytes:
                    imageBlob.size,

                    updated_at:
                    new Date()
                        .toISOString(),
                },
                {
                    onConflict:
                    'center_id,report_date',
                }
                )


            if (reportError) {
                throw reportError
            }


            /*
            * สำเร็จครบทั้ง
            * Storage + Database
            */
            setSavedImageSize(
                imageBlob.size
            )

            setIsReportSaved(true)


            alert(
                `บันทึกรายงานเรียบร้อย\nขนาดภาพ ${(
                imageBlob.size / 1024
                ).toFixed(1)} KB`
            )


            } catch (error) {

            console.error(
                'Save daily report error:',
                error
            )

            setIsReportSaved(false)


            alert(
                error?.message ||
                'ไม่สามารถบันทึกรายงานได้'
            )

            } finally {

            setIsSavingReport(false)
            }
        }

  const getReportFileName = () => {

    const centerName =
        selectedCenter?.code ||
        selectedCenter?.name ||
        form.unitName ||
        'center'

    const safeCenter =
        String(centerName)
        .replace(
            /[\\/:*?"<>|]/g,
            '-'
        )
        .replace(/\s+/g, '-')

    return (
        `daily-report-${safeCenter}-${form.reportDate || 'report'}.png`
    )
    }


    const handleDownloadPng = async () => {

    const canvas =
        previewCanvasRef.current

    if (!canvas) {
        alert('ไม่พบพื้นที่รายงาน')
        return
    }

    try {

        const dataUrl =
        await toPng(
            canvas,
            {
            cacheBust: true,
            pixelRatio: 2,
            backgroundColor: '#ffffff',

            style: {
                transform: 'none',
                transformOrigin: 'top left',
            },
            }
        )

        const link =
        document.createElement('a')

        link.download =
        getReportFileName()

        link.href = dataUrl

        link.click()

    } catch (error) {

        console.error(
        'Export PNG error:',
        error
        )

        alert(
        'ไม่สามารถบันทึกภาพได้'
        )
    }
    }


    const handleCopyImage = async () => {

    const canvas =
        previewCanvasRef.current

    if (!canvas) {
        alert('ไม่พบพื้นที่รายงาน')
        return
    }

    try {

        if (
        !navigator.clipboard ||
        !window.ClipboardItem
        ) {

        alert(
            'เบราว์เซอร์นี้ไม่รองรับการคัดลอกรูป'
        )

        return
        }

        const blob =
        await toBlob(
            canvas,
            {
            cacheBust: true,
            pixelRatio: 2,
            backgroundColor: '#ffffff',

            style: {
                transform: 'none',
                transformOrigin: 'top left',
            },
            }
        )

        if (!blob) {
        throw new Error(
            'Cannot create image blob'
        )
        }

        await navigator.clipboard.write([
        new ClipboardItem({
            'image/png': blob,
        }),
        ])

        alert(
        'คัดลอกรูปเรียบร้อยแล้ว'
        )

    } catch (error) {

        console.error(
        'Copy image error:',
        error
        )

        alert(
        'ไม่สามารถคัดลอกรูปได้'
        )
    }
    }

    const handleLineShare = async () => {

        if (!isReportSaved) {
            alert(
            'กรุณาบันทึกรายงานก่อนแชร์ LINE'
            )
            return
        }


        if (!selectedCenterId) {
            alert(
            'กรุณาเลือกศูนย์ก่อนแชร์รายงาน'
            )
            return
        }


        if (!form.reportDate) {
            alert(
            'ไม่พบวันที่รายงาน'
            )
            return
        }


        if (!liffId) {
            alert(
            'ไม่พบการตั้งค่า LIFF ID'
            )
            return
        }


        try {

            /*
            * 1. อ่านข้อมูลรายงานที่บันทึกแล้ว
            */
            const {
            data: report,
            error: reportError,
            } = await supabase
            .from('daily_reports')
            .select('image_path')
            .eq(
                'center_id',
                String(selectedCenterId)
            )
            .eq(
                'report_date',
                form.reportDate
            )
            .maybeSingle()


            if (reportError) {
            throw reportError
            }


            if (!report?.image_path) {
            throw new Error(
                'ไม่พบภาพรายงานที่บันทึกไว้'
            )
            }


            /*
            * 2. สร้าง Signed URL
            * เพราะ bucket เป็น Private
            *
            * ใช้งานได้ 1 ชั่วโมง
            */
            const {
            data: signedData,
            error: signedError,
            } = await supabase
            .storage
            .from('daily-reports')
            .createSignedUrl(
                report.image_path,
                60 * 60
            )


            if (signedError) {
            throw signedError
            }


            const imageUrl =
            signedData?.signedUrl


            if (!imageUrl) {
            throw new Error(
                'ไม่สามารถสร้างลิงก์รูปได้'
            )
            }


            /*
            * 3. เริ่ม LIFF
            */
            await liff.init({
            liffId,
            })


            /*
            * 4. ถ้ายังไม่ได้ Login LINE
            */
            if (!liff.isLoggedIn()) {

            liff.login({
                redirectUri:
                window.location.href,
            })

            return
            }


            /*
            * 5. ตรวจ Share Target Picker
            */
            if (
            !liff.isApiAvailable(
                'shareTargetPicker'
            )
            ) {

            throw new Error(
                'ไม่รองรับ LINE Share Target Picker'
            )
            }


            /*
            * 6. เปิดหน้าต่าง
            * เลือกเพื่อน / กลุ่ม LINE
            */
            await liff.shareTargetPicker(
            [
                {
                type: 'image',

                originalContentUrl:
                    imageUrl,

                previewImageUrl:
                    imageUrl,
                },
            ],
            {
                isMultiple: true,
            }
            )


        } catch (error) {

            console.error(
            'LINE Share Error:',
            error
            )

            alert(
            error?.message ||
            'ไม่สามารถแชร์เข้า LINE ได้'
            )
        }
        }

  return (
    <div className="daily-report-page">

      <header className="daily-report-header">

        <div>
          <h1>Daily Report</h1>

          <p>
            สร้างรายงานประจำวัน
            และ Infographic อัตโนมัติ
          </p>
        </div>

      </header>


      <div className="daily-report-workspace">

        {/* =========================
            LEFT FORM
        ========================== */}

        <aside className="daily-report-form-panel">

          <div className="daily-report-action-bar">

            <button
                type="button"
                className="daily-save-report-button"
                onClick={handleSaveReport}
                disabled={isSavingReport}
            >
                {isSavingReport
                ? 'กำลังบันทึก...'
                : isReportSaved
                    ? '✓ บันทึกแล้ว'
                    : 'บันทึกงาน'}
            </button>


            <button
                type="button"
                className="daily-primary-button"
                onClick={handleDownloadPng}
                disabled={
                !isReportSaved ||
                isSavingReport
                }
            >
                บันทึก PNG
            </button>


            <button
                type="button"
                onClick={handleCopyImage}
                disabled={
                !isReportSaved ||
                isSavingReport
                }
            >
                คัดลอกรูป
            </button>


            <button
                type="button"
                className="daily-line-button"
                onClick={handleLineShare}
                disabled={
                !isReportSaved ||
                isSavingReport
                }
            >
                LINE แชร์
            </button>

            </div>


          <section className="daily-form-section">

            <div className="daily-section-title">
                ข้อมูลรายงาน
                </div>


                {isAdmin && (

                <label>
                    ศูนย์ที่จัดทำรายงาน

                    <select
                    value={selectedCenterId}
                    onChange={(e) =>
                        setSelectedCenterId(
                        e.target.value
                        )
                    }
                    >

                    <option value="">
                        -- เลือกศูนย์ --
                    </option>

                    {centers.map(
                        (center) => (

                        <option
                            key={center.id}
                            value={center.id}
                        >
                            {center.name}
                            {center.code
                            ? ` (${center.code})`
                            : ''}
                        </option>

                        )
                    )}

                    </select>

                </label>

                )}


                {isCenter && (

                <div className="daily-center-locked">

                    <span>
                    ศูนย์ที่จัดทำรายงาน
                    </span>

                    <strong>
                    {selectedCenter?.name ||
                        profile?.agency ||
                        '-'}
                    </strong>

                    <small>
                    ศูนย์ประจำบัญชีผู้ใช้งาน
                    </small>

                </div>

                )}

            <label>
              ชื่อรายงาน

              <input
                value={form.reportTitle}
                onChange={(e) =>
                  changeField(
                    'reportTitle',
                    e.target.value
                  )
                }
              />
            </label>

            <label>
              ชื่อหน่วยงาน

              <input
                value={form.unitName}
                onChange={(e) =>
                  changeField(
                    'unitName',
                    e.target.value
                  )
                }
              />
            </label>

            <label>
              วันที่รายงาน

              <input
                type="date"
                value={form.reportDate}
                onChange={(e) =>
                  changeField(
                    'reportDate',
                    e.target.value
                  )
                }
              />
            </label>

          </section>


          <section className="daily-form-section">

            <div className="daily-section-title">
              โลโก้หน่วยงาน
            </div>

            <div className="daily-logo-upload">

                <input
                    id="daily-logo-input"
                    className="daily-logo-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={isLogoSaving}
                    onChange={(e) => {

                        const file =
                        e.target.files?.[0]

                        handleLogoChange(file)

                        e.target.value = ''
                    }}
                />

                <label
                    htmlFor="daily-logo-input"
                    className="daily-logo-upload-button"
                >
                    <span className="daily-logo-upload-icon">
                    +
                    </span>

                    <span>
                        {isLogoSaving
                            ? 'กำลังบันทึก...'
                            : logo
                            ? 'เปลี่ยนโลโก้'
                            : 'เลือกโลโก้'}
                    </span>
                </label>


                <div className="daily-logo-file-info">

                    {logo ? (

                    <>
                        <div className="daily-logo-thumb">
                        <img
                            src={logo}
                            alt="โลโก้หน่วยงาน"
                        />
                        </div>

                        <div className="daily-logo-file-text">

                        <strong>
                            {logoName}
                        </strong>

                        <span>
                            PNG, JPG หรือ WEBP
                        </span>

                        </div>
                    </>

                    ) : (

                    <div className="daily-logo-empty">

                        <strong>
                        ยังไม่ได้เลือกโลโก้
                        </strong>

                        <span>
                        รองรับ PNG, JPG และ WEBP
                        </span>

                    </div>

                    )}

                </div>

                </div>

          </section>


          <section className="daily-form-section">

            <div className="daily-section-title">
              1. สถานะกล้อง
            </div>

            <div className="daily-two-column">

              <label>
                กล้องพร้อมใช้งาน

                <input
                  type="number"
                  min="0"
                  value={form.cameraReady}
                  onChange={(e) =>
                    changeNumber(
                      'cameraReady',
                      e.target.value
                    )
                  }
                />
              </label>

              <label>
                กล้องเสีย

                <input
                  type="number"
                  min="0"
                  value={form.cameraBroken}
                  onChange={(e) =>
                    changeNumber(
                      'cameraBroken',
                      e.target.value
                    )
                  }
                />
              </label>

            </div>

          </section>


          <section className="daily-form-section">

            <div className="daily-section-title">
              2. ค่าเฉลี่ยเดือนนี้
            </div>

            <div className="daily-two-column">

              <label>
                พร้อมใช้งานเฉลี่ย

                <input
                  type="number"
                  step="0.01"
                  value={form.avgCameraReady}
                  onChange={(e) =>
                    changeNumber(
                      'avgCameraReady',
                      e.target.value
                    )
                  }
                />
              </label>

              <label>
                กล้องเสียเฉลี่ย

                <input
                  type="number"
                  step="0.01"
                  value={form.avgCameraBroken}
                  onChange={(e) =>
                    changeNumber(
                      'avgCameraBroken',
                      e.target.value
                    )
                  }
                />
              </label>

            </div>

          </section>


          <section className="daily-form-section">

            <div className="daily-section-title">
              3. สถิติงานซ่อม
            </div>

            <label>
              งานซ่อมสะสมทั้งหมด

              <input
                type="number"
                value={form.repairTotal}
                onChange={(e) =>
                  changeNumber(
                    'repairTotal',
                    e.target.value
                  )
                }
              />
            </label>

            <div className="daily-three-column">

              <label>
                ภายใน 24 ชม.

                <input
                  type="number"
                  value={form.repair24}
                  onChange={(e) =>
                    changeNumber(
                      'repair24',
                      e.target.value
                    )
                  }
                />
              </label>

              <label>
                24-48 ชม.

                <input
                  type="number"
                  value={form.repair48}
                  onChange={(e) =>
                    changeNumber(
                      'repair48',
                      e.target.value
                    )
                  }
                />
              </label>

              <label>
                48-72 ชม.

                <input
                  type="number"
                  value={form.repair72}
                  onChange={(e) =>
                    changeNumber(
                      'repair72',
                      e.target.value
                    )
                  }
                />
              </label>

            </div>

          </section>


          <section className="daily-form-section">

            <div className="daily-section-title">
              4. เหตุการณ์ประจำวัน
            </div>

            <div className="daily-two-column">

              <NumberInput
                label="เหตุก่อความไม่สงบ"
                value={form.dailyUnrest}
                onChange={(value) =>
                  changeNumber(
                    'dailyUnrest',
                    value
                  )
                }
              />

              <NumberInput
                label="อุบัติเหตุ"
                value={form.dailyAccident}
                onChange={(value) =>
                  changeNumber(
                    'dailyAccident',
                    value
                  )
                }
              />

              <NumberInput
                label="อาชญากรรม"
                value={form.dailyCrime}
                onChange={(value) =>
                  changeNumber(
                    'dailyCrime',
                    value
                  )
                }
              />

              <NumberInput
                label="เหตุจากระบบ LPR / AI"
                value={form.dailySystem}
                onChange={(value) =>
                  changeNumber(
                    'dailySystem',
                    value
                  )
                }
              />

            </div>

          </section>


          <section className="daily-form-section">

            <div className="daily-section-title">
              5. เหตุการณ์สะสม
            </div>

            <div className="daily-two-column">

              <NumberInput
                label="เหตุก่อความไม่สงบ"
                value={form.totalUnrest}
                onChange={(value) =>
                  changeNumber(
                    'totalUnrest',
                    value
                  )
                }
              />

              <NumberInput
                label="อุบัติเหตุ"
                value={form.totalAccident}
                onChange={(value) =>
                  changeNumber(
                    'totalAccident',
                    value
                  )
                }
              />

              <NumberInput
                label="อาชญากรรม"
                value={form.totalCrime}
                onChange={(value) =>
                  changeNumber(
                    'totalCrime',
                    value
                  )
                }
              />

              <NumberInput
                label="เหตุจากระบบ LPR / AI"
                value={form.totalSystem}
                onChange={(value) =>
                  changeNumber(
                    'totalSystem',
                    value
                  )
                }
              />

            </div>

          </section>

        </aside>


        {/* =========================
            RIGHT PREVIEW
        ========================== */}

        <main
            className="daily-report-preview-area"
            ref={previewAreaRef}
            >

            <div
                className="daily-report-scale-wrapper"
                style={{
                    width:
                    `${1200 * previewScale}px`,

                    height:
                    `${
                        previewCanvasHeight *
                        previewScale
                    }px`,
                }}
            >

            <div
                ref={previewCanvasRef}
                className="daily-report-canvas"
                id="daily-report-canvas"
                style={{
                    transform:
                    `scale(${previewScale})`,
                }}
            >

            <div className="daily-infographic-header">

              <div className="daily-logo-box">
                {logo ? (
                    <img
                        src={logo}
                        alt="โลโก้หน่วยงาน"
                    />
                    ) : (
                    <span>LOGO</span>
                    )}
              </div>

              <div className="daily-title-area">

                <h2>
                  {form.reportTitle}
                  {' '}
                  {form.unitName}
                </h2>

                <div className="daily-title-line" />

              </div>

              <div className="daily-report-date">

                <strong>
                  ประจำวันที่
                </strong>

                <span>
                  {formatThaiDate(
                    form.reportDate
                  )}
                </span>

              </div>

              

            </div>


            <div className="daily-top-grid">

              <ReportCard
                number="1"
                title="สถานะกล้อง"
              >

                <StatRow
                  label="กล้องพร้อมใช้งาน"
                  value={form.cameraReady}
                  suffix="ตัว"
                />

                <StatRow
                  label="กล้องเสีย"
                  value={form.cameraBroken}
                  suffix="ตัว"
                />

                <Donut
                  percent={
                    cameraReadyPercent
                  }
                />

              </ReportCard>


              <ReportCard
                number="2"
                title="ค่าเฉลี่ยเดือนนี้"
              >

                <StatRow
                  label="พร้อมใช้งานเฉลี่ย"
                  value={
                    form.avgCameraReady
                  }
                  suffix="ตัว"
                />

                <StatRow
                  label="กล้องเสียเฉลี่ย"
                  value={
                    form.avgCameraBroken
                  }
                  suffix="ตัว"
                />

                <Donut
                  percent={
                    averageReadyPercent
                  }
                />

              </ReportCard>


              <ReportCard
                number="3"
                title="สถิติงานซ่อมทั้งหมด"
              >

                <StatRow
                  label="งานซ่อมสะสม"
                  value={form.repairTotal}
                  suffix="รายการ"
                />

                <MiniRepair
                  label="ภายใน 24 ชม."
                  value={form.repair24}
                  percent={
                    repairPercent(
                      form.repair24
                    )
                  }
                />

                <MiniRepair
                  label="ภายใน 24-48 ชม."
                  value={form.repair48}
                  percent={
                    repairPercent(
                      form.repair48
                    )
                  }
                />

                <MiniRepair
                  label="ภายใน 48-72 ชม."
                  value={form.repair72}
                  percent={
                    repairPercent(
                      form.repair72
                    )
                  }
                />

              </ReportCard>

            </div>


            <div className="daily-bottom-grid">

              <EventCard
                number="4"
                title="สถิติเหตุการณ์ประจำวัน"
                total={dailyEventTotal}
                values={[
                  {
                    label:
                      'เหตุก่อความไม่สงบ',
                    value:
                      form.dailyUnrest,
                  },
                  {
                    label: 'อุบัติเหตุ',
                    value:
                      form.dailyAccident,
                  },
                  {
                    label: 'อาชญากรรม',
                    value:
                      form.dailyCrime,
                  },
                  {
                    label:
                      'เหตุจากระบบ (LPR, AI)',
                    value:
                      form.dailySystem,
                  },
                ]}
              />


              <EventCard
                number="5"
                title="สถิติเหตุการณ์สะสมตั้งแต่เปิดระบบ"
                total={
                  cumulativeEventTotal
                }
                values={[
                  {
                    label:
                      'เหตุก่อความไม่สงบ',
                    value:
                      form.totalUnrest,
                  },
                  {
                    label: 'อุบัติเหตุ',
                    value:
                      form.totalAccident,
                  },
                  {
                    label: 'อาชญากรรม',
                    value:
                      form.totalCrime,
                  },
                  {
                    label:
                      'เหตุจากระบบ (LPR, AI)',
                    value:
                      form.totalSystem,
                  },
                ]}
              />

            </div>


            <div className="daily-report-footer">
              ข้อมูลจากระบบบริหารจัดการ
              กล้องวงจรปิด {form.unitName}
            </div>

          </div>

          </div>

        </main>

      </div>

    </div>
  )
}


function NumberInput({
  label,
  value,
  onChange,
}) {
  return (
    <label>
      {label}

      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) =>
          onChange(e.target.value)
        }
      />
    </label>
  )
}


function ReportCard({
  number,
  title,
  children,
}) {
  return (
    <section className="daily-preview-card">

      <div className="daily-preview-card-title">

        <strong>
          {number}
        </strong>

        <span>
          {title}
        </span>

      </div>

      <div className="daily-preview-card-body">
        {children}
      </div>

    </section>
  )
}


function StatRow({
  label,
  value,
  suffix,
}) {
  return (
    <div className="daily-stat-row">

      <span>
        {label}
      </span>

      <strong>
        {value}
        {' '}
        <small>
          {suffix}
        </small>
      </strong>

    </div>
  )
}


function Donut({
  percent,
}) {
  const safePercent =
    Math.min(
      100,
      Math.max(
        0,
        Number(percent || 0)
      )
    )

  return (
    <div
      className="daily-donut"
      style={{
        '--percent':
          `${safePercent}%`,
      }}
    >

      <div>
        <strong>
          {safePercent.toFixed(1)}
        </strong>

        <span>%</span>
      </div>

    </div>
  )
}


function MiniRepair({
  label,
  value,
  percent,
}) {
  return (
    <div className="daily-repair-row">

      <div>
        <strong>
          {value}
        </strong>

        <span>
          {label}
        </span>
      </div>

      <b>
        {percent}%
      </b>

    </div>
  )
}


function EventCard({
  number,
  title,
  total,
  values,
}) {
  const maxValue =
    Math.max(
      ...values.map(
        (item) =>
          Number(item.value || 0)
      ),
      1
    )

  return (
    <section className="daily-event-card">

      <div className="daily-event-title">

        <strong>
          {number}
        </strong>

        <div>
          <h3>
            {title}
          </h3>

          <span>
            จำนวนเหตุการณ์
            {' '}
            <b>{total}</b>
            {' '}
            เหตุการณ์
          </span>
        </div>

      </div>


      <div className="daily-event-body">

        <div className="daily-bar-chart">

          {values.map(
            (item) => {

              const height =
                Math.max(
                  2,
                  (
                    Number(
                      item.value || 0
                    ) /
                    maxValue
                  ) * 100
                )

              return (
                <div
                  className="daily-bar-item"
                  key={item.label}
                >

                  <div
                    className="daily-bar"
                    style={{
                      height:
                        `${height}%`,
                    }}
                  />

                  <span>
                    {item.label}
                  </span>

                </div>
              )
            }
          )}

        </div>


        <div className="daily-event-summary">

          {values.map(
            (item) => (
              <div key={item.label}>

                <span>
                  {item.label}
                </span>

                <strong>
                  {item.value}
                </strong>

              </div>
            )
          )}

        </div>

      </div>

    </section>
  )
}


export default DailyReport