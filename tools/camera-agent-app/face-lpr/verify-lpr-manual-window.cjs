'use strict'
// Stage 21.4.8: synthetic, no NVR, no uploads or real credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')
const { prepareLprPlaybackJobs, captureOnePlannedSample, manualPlaybackWindow } = require('./lpr-playback-jobs.cjs')
const { prepareOneSample } = require('./lpr-planned-sample-smoke.cjs')

async function main() {
  const original = readConfig(path.join(__dirname, 'pilot.config.json'))
  const fields = {
    'items[0].Channel':'8', 'items[0].StartTime':'2026-10-31 12:34:15',
    'items[0].SummaryNew[0].Value.Candidates[0].Person.Name':'SYNTHETIC ONLY',
    'items[0].SummaryNew[0].Value.Candidates[0].Person.GroupName':'High Risk Person',
    'items[0].SummaryNew[0].Value.Candidates[0].Similarity':'91',
  }
  const {config,assessment,job} = prepareOneSample({original,fields})
  const before = JSON.stringify(original)
  assert.equal(prepareLprPlaybackJobs({ config, assessment }).jobs.length, 5)
  assert.equal(job.endTimeRtsp, '2026_10_31_12_34_13')
  const extend = manualPlaybackWindow(job, 10)
  assert.equal(extend.startTimeRtsp, '2026_10_31_12_34_10')
  assert.equal(extend.endTimeRtsp, '2026_10_31_12_34_20')
  assert.equal(manualPlaybackWindow(job, 5).endTimeRtsp, '2026_10_31_12_34_15')
  assert.equal(manualPlaybackWindow(job).endTimeRtsp, '2026_10_31_12_34_13')
  for (const invalid of [0,3,11,100,'10',undefined]) {
    // undefined is default (3s); never treated as a 10s override
    if (invalid === undefined) continue
    assert.throws(()=>manualPlaybackWindow(job,invalid),/INVALID_MANUAL_WINDOW_SECONDS/)
  }
  assert.equal(JSON.stringify(original),before)
  assert.equal(original.enabled,false)
  assert.equal(original.nvrs[0].enabled,false)
  assert.equal(prepareLprPlaybackJobs({config,assessment}).jobs[0].endTimeRtsp,'2026_10_31_12_34_13')
  console.log('PASS: manual one-sample 10s window (12:34:10-12:34:20); normal 5-job plan unchanged')

  let got=null,diagnostic=null,called=0
  const fixture=fs.readFileSync(path.join(__dirname,'fixtures','synthetic-lpr-test.h264'))
  const captureH264=async options=>{
    called++
    got=options
    assert.equal(options.host,'172.17.2.23')
    assert.equal(options.uiChannel,6)
    return {
      describeStatus:200,setupStatus:200,playStatus:200,teardownStatus:200,
      videoSdp:true,sameTcpDigest:true,codec:'H264',rtpPackets:12,
      teardownSent:true,h264:fixture,
    }
  }
  const args={config,assessment,jobIndex:0,username:'synthetic',password:'FAKE_ONLY',manualWindowSeconds:10,captureH264,
    onMediaDiagnostic: value=>{ diagnostic=value }}
  await assert.rejects(()=>captureOnePlannedSample(args),/EXPLICIT_MANUAL_TEST_REQUIRED/)
  assert.equal(called,0)
  const answer=await captureOnePlannedSample({...args,manualReadOnly:true})
  assert.equal(got.startTime,'2026_10_31_12_34_10')
  assert.equal(got.endTime,'2026_10_31_12_34_20')
  assert.equal(got.captureMs,8000)
  assert.equal(got.maxMediaBytes,7*1024*1024)
  assert.equal(answer.verifiedJpeg,true)
  assert.equal(answer.actualFrameTime,'UNKNOWN')
  assert.ok(answer.jpeg.length>100)
  assert.deepEqual([diagnostic.describe,diagnostic.setup,diagnostic.play,diagnostic.teardown],[200,200,200,200])
  assert.equal(JSON.stringify(original),before)
  console.log('PASS: synthetic RTP -> FFmpeg -> in-memory JPEG; one manual sample and status-only diagnostics')

  diagnostic=null
  await assert.rejects(()=>captureOnePlannedSample({...args,manualReadOnly:true,
    captureH264:async()=>({describeStatus:200,setupStatus:null,playStatus:null,rtpPackets:0,teardownSent:false,h264:Buffer.alloc(0)})}),/RTSP_MEDIA_NOT_CONFIRMED/)
  assert.equal(diagnostic.describe,200)
  assert.equal(diagnostic.setup,null)
  assert.equal(diagnostic.rtpPackets,0)
  console.log('PASS: no-media fails closed with safe stage statuses; no silent success')
  console.log('LPR_MANUAL_10S_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
}
main().catch(error=>{console.error('LPR_MANUAL_10S_OFFLINE_TEST: FAIL',error.message);process.exitCode=1})
