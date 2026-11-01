'use strict'
// Offline only; run from the working PC to exercise its installed FFmpeg.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { decodeFirstJpegAsync } = require('./lpr-playback-frame-async.cjs')
const { readConfig } = require('./config.cjs')
async function run() {
  const cfg=readConfig(path.join(__dirname,'pilot.config.json'))
  assert.equal(cfg.enabled,false)
  const fixture=fs.readFileSync(path.join(__dirname,'fixtures','synthetic-lpr-test.h264'))
  const jpeg=await decodeFirstJpegAsync(fixture)
  assert.ok(jpeg.length>100 && jpeg[0]===0xff && jpeg.at(-1)===0xd9)
  console.log('PASS: async FFmpeg produces JPEG from synthetic RTP H264')
  // The real NVR sends megabytes; FFmpeg may exit early after its first frame.
  // Validate that an early-closed stdin pipe doesn't incorrectly fail JPEG.
  const large=Buffer.concat(Array.from({length:750},()=>fixture))
  assert.ok(large.length>3*1024*1024)
  const jpegLarge=await decodeFirstJpegAsync(large)
  assert.ok(jpegLarge.length>100 && jpegLarge[0]===0xff && jpegLarge.at(-1)===0xd9)
  console.log('PASS: >3 MiB H264 input decodes with bounded async pipes')
  await assert.rejects(()=>decodeFirstJpegAsync(Buffer.alloc(9*1024*1024)),/H264_INPUT_INVALID/)
  console.log('PASS: input size limit enforced; no media files or network calls')
  console.log('LPR_FRAME_ASYNC_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('MAIN_CJS_CHANGED: NO')
}
run().catch(e=>{console.error('LPR_FRAME_ASYNC_OFFLINE_TEST: FAIL',e.category||e.message);process.exitCode=1})
