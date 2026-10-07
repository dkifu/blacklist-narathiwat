import './AlertReport.css'

function AlertReport() {

  const reportUrl =
    `${import.meta.env.BASE_URL}templates/VSS05_AlertReport.html`

  return (
    <div className="alert-report-page">

      <iframe
        className="alert-report-frame"
        src={reportUrl}
        title="VSS05 รายงานการแจ้งเตือน"
      />

    </div>
  )
}

export default AlertReport