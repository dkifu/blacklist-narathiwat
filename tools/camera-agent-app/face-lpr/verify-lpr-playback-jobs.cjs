'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readConfig } = require('./config.cjs')
const { evaluateHistoricalFaceRecord } = require('./high-risk-filter.cjs')
const { prepareLprPlaybackJobs, captureOnePlannedSample } = require('./lpr-playback-jobs.cjs')
const { decodeFirstJpegAsync } = require('./lpr-playback-frame-async.cjs')
const clone = x => structuredClone(x)

async function main() {
  const original = readConfig(path.join(__dirname, 'pilot.config.json'))
  const cfg = clone(original); cfg.enabled = true; cfg.nvrs[0].enabled = true
  const fake = {
    'items[0].Channel': '8', 'items[0].StartTime': '2026-10-31 12:34:15',
    'items[0].SummaryNew[0].Value.Candidates[0].Person.Name': 'SYNTHETIC ONLY',
    'items[0].SummaryNew[0].Value.Candidates[0].Person.GroupName': 'High Risk Person',
    'items[0].SummaryNew[0].Value.Candidates[0].Similarity': '91',
  }
  const assessment = evaluateHistoricalFaceRecord({config:cfg, nvrId:'yakang-nvr-01', fields:fake})
  assert.equal(assessment.qualified, true)
  assert.equal(prepareLprPlaybackJobs({config:original, assessment}).reason, 'MODULE_DISABLED')
  assert.equal(original.enabled, false)
  assert.equal(original.nvrs[0].enabled, false)
  const plan = prepareLprPlaybackJobs({config:cfg, assessment})
  assert.equal(plan.prepared,true)
  assert.equal(plan.blocked.length,0)
  assert.equal(plan.jobs.length,5)
  assert.deepEqual(plan.jobs.map(j=>j.startTimeRtsp), [
    '2026_10_31_12_34_10', '2026_10_31_12_34_11', '2026_10_31_12_34_12',
    '2026_10_31_12_34_13', '2026_10_31_12_34_14'])
  assert.deepEqual(plan.jobs.map(j=>j.endTimeRtsp), [
    '2026_10_31_12_34_13', '2026_10_31_12_34_14', '2026_10_31_12_34_15',
    '2026_10_31_12_34_15', '2026_10_31_12_34_15'])
  assert.ok(plan.jobs.every(j=>j.target.channel===6 && j.actualFrameTime==='UNKNOWN'))
  assert.ok(!JSON.stringify(plan).includes('SYNTHETIC ONLY'))
  console.log('PASS: face 9 -> LPR 6 produces five bounded NVR-local playback requests; frame times unknown')

  let called = 0
  const mediaFixture = fs.readFileSync(path.join(__dirname,'fixtures','synthetic-lpr-test.h264'))
  const captureH264 = async opts => {
    called++
    assert.equal(opts.host,'172.17.2.23')
    assert.equal(opts.uiChannel,6)
    assert.equal(opts.startTime,'2026_10_31_12_34_10')
    assert.equal(opts.endTime,'2026_10_31_12_34_13')
    assert.equal(opts.password,'TEST_ONLY_NOT_A_REAL_PASSWORD')
    return {describeStatus:200,setupStatus:200,playStatus:200,rtpPackets:10,teardownSent:true,h264:mediaFixture}
  }
  const args = {config:cfg,assessment,jobIndex:0,username:'fake-user',password:'TEST_ONLY_NOT_A_REAL_PASSWORD', captureH264,decodeH264:decodeFirstJpegAsync}
  await assert.rejects(()=>captureOnePlannedSample(args),/EXPLICIT_MANUAL_TEST_REQUIRED/)
  assert.equal(called,0)
  const out = await captureOnePlannedSample({...args, manualReadOnly:true})
  assert.equal(called,1)
  assert.equal(out.verifiedJpeg,true)
  assert.equal(out.actualFrameTime,'UNKNOWN')
  assert.ok(out.jpeg.length>100 && out.jpeg[0]===255)
  console.log('PASS: explicit manual gate; injected playback adapter -> real FFmpeg -> in-memory JPEG, no NVR')

  const cross = clone(cfg)
  cross.nvrs.push({id:'nvr-02',host:'172.17.2.24',enabled:true,cameras:[{id:'lpr-two',type:'lpr',channel:1}]})
  cross.mappings[0].lprCameraIds.push('lpr-two')
  const assCross = evaluateHistoricalFaceRecord({config:cross,nvrId:'yakang-nvr-01',fields:fake})
  const jobsCross = prepareLprPlaybackJobs({config:cross,assessment:assCross})
  assert.equal(jobsCross.jobs.length,5)
  assert.equal(jobsCross.blocked.length,1)
  assert.equal(jobsCross.blocked[0].reason,'CROSS_NVR_CLOCK_SYNC_REQUIRED')
  await assert.rejects(()=>captureOnePlannedSample({...args,config:cross, assessment:assCross, manualReadOnly:true}),/PLAYBACK_PLAN_NOT_READY/)
  assert.equal(called,1)
  const publicHost = clone(cfg)
  publicHost.nvrs[0].host = '8.8.8.8'
  const publicPlan = prepareLprPlaybackJobs({config:publicHost,assessment})
  assert.equal(publicPlan.jobs.length,0)
  assert.equal(publicPlan.blocked[0].reason,'PRIVATE_ENABLED_NVR_REQUIRED')
  console.log('PASS: cross-NVR clock sync and public targets blocked, no partial multi-target execution')

  const tampered = clone(assessment)
  tampered.alert.personId='FAKE'
  assert.equal(prepareLprPlaybackJobs({config:cfg,assessment:tampered}).jobs.length,0)
  assert.equal(called,1)
  await assert.rejects(()=>captureOnePlannedSample({...args,manualReadOnly:true,captureH264:async()=>({describeStatus:200,setupStatus:200,playStatus:200,rtpPackets:0,teardownSent:true,h264:mediaFixture})}),/RTSP_MEDIA_NOT_CONFIRMED/)
  await assert.rejects(()=>captureOnePlannedSample({...args,manualReadOnly:true,captureH264,decodeH264:async()=>Buffer.from('not a jpeg')}),/JPEG_INVALID/)
  console.log('PASS: spoofed assessment, empty RTP and invalid JPEG rejected')
  console.log('LPR_PLAYBACK_JOBS_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
}
main().catch(e=>{ console.error('LPR_PLAYBACK_JOBS_OFFLINE_TEST: FAIL',e.message);process.exitCode=1})
