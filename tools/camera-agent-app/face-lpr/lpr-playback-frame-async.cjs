'use strict'
// Manual pilot-only, bounded FFmpeg decode using async pipes.
// Large H264 inputs can trigger spawnSync EPIPE when FFmpeg exits after one frame.
// Keep the existing sync decoder unchanged for compatibility and mock tests.
const { spawn } = require('node:child_process')
const { inspectH264 } = require('./lpr-playback-frame-decode.cjs')

const MAX_H264 = 8 * 1024 * 1024
const MAX_JPEG = 5 * 1024 * 1024
const MAX_STDERR = 32 * 1024
const FF_TIMEOUT_MS = 12000

function nalUnits(data) {
  const marks = []
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue
    const n = data[i + 2] === 1 ? 3 : (data[i + 2] === 0 && data[i + 3] === 1 ? 4 : 0)
    if (n) { marks.push([i, n]); i += n - 1 }
  }
  return marks.map(([pos,len],i) => ({start:pos, end:i+1<marks.length?marks[i+1][0]:data.length,
    type: pos+len<data.length ? data[pos+len]&31:0}))
}

function oneGopFromIdr(data) {
  const nals = nalUnits(data)
  const idr = nals.findIndex(x => x.type===5)
  if (idr<0) return null
  const sps = nals.slice(0,idr).filter(x=>x.type===7).slice(-1)[0]
  const pps = nals.slice(0,idr).filter(x=>x.type===8).slice(-1)[0]
  if (!sps || !pps) return null
  // Include the first IDR and later slices until the next AUD/SPS/IDR (if present).
  // On some Dahua streams IDR consists of multiple slices; allow following NALs.
  const next = nals.findIndex((n,i)=>i>idr && (n.type===9 || n.type===7 || n.type===5))
  const end = next>=0 ? nals[next].start : data.length
  return Buffer.concat([data.subarray(sps.start,sps.end),data.subarray(pps.start,pps.end),data.subarray(nals[idr].start,end)])
}

function classify(errText, stdinError, execError, exitCode, timeout) {
  if (timeout) return 'FFMPEG_TIMEOUT'
  if (execError === 'ENOENT') return 'FFMPEG_NOT_FOUND'
  if (execError) return 'FFMPEG_LAUNCH_FAILED'
  if (stdinError && stdinError !== 'EPIPE' && stdinError !== 'ECONNRESET') return 'FFMPEG_INPUT_PIPE_ERROR'
  if (/non-existing PPS|pps_id|PPS unavailable/i.test(errText)) return 'H264_PPS_UNAVAILABLE'
  if (/SPS unavailable|sps_id|invalid.*SPS/i.test(errText)) return 'H264_SPS_UNAVAILABLE'
  if (/decode_slice_header|error while decoding|missing picture|no frame/i.test(errText)) return 'H264_FRAME_INCOMPLETE'
  if (/invalid data|invalid NAL|error splitting/i.test(errText)) return 'H264_INVALID_BITSTREAM'
  if (stdinError === 'EPIPE' || stdinError === 'ECONNRESET') return 'FFMPEG_EARLY_STDIN_CLOSE'
  return exitCode===0 ? 'JPEG_OUTPUT_INVALID' : 'FFMPEG_DECODE_FAILED'
}

function runFFmpeg(input, ffmpeg='ffmpeg') {
  return new Promise(resolve => {
    const args = ['-hide_banner','-nostdin','-loglevel','error','-threads','1',
      '-f','h264','-i','pipe:0','-map','0:v:0','-frames:v','1',
      '-q:v','3','-f','image2pipe','-vcodec','mjpeg','pipe:1']
    let child
    try { child=spawn(ffmpeg,args,{stdio:['pipe','pipe','pipe'],windowsHide:true}) }
    catch { resolve({jpeg:null,reason:'FFMPEG_LAUNCH_FAILED'});return }
    let stdout=[],total=0,stderr='',stdinError=null,execError=null,timeout=false,oversize=false
    const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL')},FF_TIMEOUT_MS)
    child.stdout.on('data',part=>{
      total+=part.length
      if(total>MAX_JPEG){oversize=true;child.kill('SIGKILL')}
      else stdout.push(part)
    })
    child.stderr.on('data',part=>{
      if(stderr.length<MAX_STDERR) stderr+=(part.toString('utf8').slice(0,MAX_STDERR-stderr.length))
    })
    child.stdin.on('error',e=>{stdinError=e.code||'OTHER'})
    child.on('error',e=>{execError=e.code||'OTHER'})
    child.on('close',code=>{
      clearTimeout(timer)
      const buf=!oversize ? Buffer.concat(stdout,total) : Buffer.alloc(0)
      const valid=code===0 && !timeout && !oversize && !execError && buf.length>=100 &&
        buf[0]===0xff && buf[1]===0xd8 && buf[buf.length-2]===0xff && buf[buf.length-1]===0xd9
      resolve({jpeg:valid?buf:null,reason:valid?'OK':oversize?'FFMPEG_JPEG_TOO_LARGE':classify(stderr,stdinError,execError,code,timeout)})
    })
    // EPIPE can be normal: FFmpeg may finish the first JPEG before consuming
    // the remaining H264. Never treat an EPIPE as failure if JPEG is valid.
    child.stdin.end(input)
  })
}

async function decodeFirstJpegAsync(h264,ffmpeg='ffmpeg') {
  if (!Buffer.isBuffer(h264) || h264.length<1 || h264.length>MAX_H264) {
    const e=new Error('H264_INPUT_INVALID');e.category=e.message;throw e
  }
  const stats=inspectH264(h264)
  if (!stats.sps || !stats.pps || !stats.idr) {
    const e=new Error('NO_SPS_PPS_IDR_IN_H264');e.category=e.message;throw e
  }
  // Keyframe-only candidate first: limit input size and pipe write pressure.
  // Full capture fallback for streams that need additional headers or slices.
  const short=oneGopFromIdr(h264)
  const attempts=[...(short ? [short]:[]),h264]
  let reason='NO_DECODABLE_FRAME'
  for (const input of attempts) {
    const r=await runFFmpeg(input,ffmpeg)
    if (r.jpeg) return r.jpeg
    reason=r.reason
    if (reason==='FFMPEG_NOT_FOUND' || reason==='FFMPEG_LAUNCH_FAILED') break
  }
  const e=new Error('FFMPEG_FRAME_DECODE_FAILED');e.category=reason;throw e
}

module.exports={decodeFirstJpegAsync}
