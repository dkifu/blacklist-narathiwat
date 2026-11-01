'use strict'
// Bounded in-memory decoder. No NVR credentials or media paths in FFmpeg args.
const { spawnSync } = require('node:child_process')
const MAX_H264 = 8 * 1024 * 1024
const MAX_JPEG = 5 * 1024 * 1024

function scanAnnexB(data) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_H264) throw new Error('H264_INPUT_INVALID')
  const starts = []
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue
    const len = data[i + 2] === 1 ? 3 : (data[i + 2] === 0 && data[i + 3] === 1 ? 4 : 0)
    if (len) { starts.push([i, len]); i += len - 1 }
  }
  return starts.map(([start, prefix], i) => ({
    start, end: i + 1 < starts.length ? starts[i + 1][0] : data.length,
    type: start + prefix < data.length ? data[start + prefix] & 31 : 0
  })).filter(n => n.end > n.start + 4)
}

function inspectH264(data) {
  const nal = scanAnnexB(data)
  return Object.freeze({ nals: nal.length,
    sps: nal.filter(n => n.type === 7).length,
    pps: nal.filter(n => n.type === 8).length,
    idr: nal.filter(n => n.type === 5).length })
}

// H264 playback can start mid-GOP with P slices which are not independently decodable.
// Construct a second candidate beginning at the earliest received IDR with the
// most recently advertised SPS and PPS preceding it. Do not fabricate a frame.
function fromFirstIdr(data) {
  const units = scanAnnexB(data)
  const i = units.findIndex(n => n.type === 5)
  if (i < 0) return null
  const sps = units.slice(0, i).filter(n => n.type === 7).slice(-2)
  const pps = units.slice(0, i).filter(n => n.type === 8).slice(-2)
  if (!sps.length || !pps.length) return null
  const headers = [...sps, ...pps].sort((a, b) => a.start - b.start).map(n => data.subarray(n.start, n.end))
  return Buffer.concat([...headers, data.subarray(units[i].start)])
}

function ffmpegCategory(out) {
  if (out.error?.code === 'ETIMEDOUT') return 'FFMPEG_TIMEOUT'
  if (out.error?.code === 'ENOBUFS') return 'FFMPEG_OUTPUT_LIMIT'
  if (out.error) return 'FFMPEG_SPAWN_ERROR'
  const err = (out.stderr || Buffer.alloc(0)).toString('utf8').slice(0, 32768)
  if (/non-existing PPS|pps_id|PPS unavailable/i.test(err)) return 'H264_PPS_UNAVAILABLE'
  if (/SPS unavailable|sps_id|invalid.*SPS/i.test(err)) return 'H264_SPS_UNAVAILABLE'
  if (/decode_slice_header|error while decoding|missing picture|no frame/i.test(err)) return 'H264_FRAME_INCOMPLETE'
  if (/invalid data|invalid NAL|error splitting/i.test(err)) return 'H264_INVALID_BITSTREAM'
  if (/Nothing was written|does not contain any stream|Could not find codec parameters/i.test(err)) return 'NO_DECODABLE_FRAME'
  return out.status === 0 ? 'JPEG_OUTPUT_INVALID' : 'FFMPEG_DECODE_FAILED'
}

function tryDecode(buffer, ffmpeg, skipNonKey) {
  const args = [ '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-threads', '1', ...(skipNonKey ? ['-skip_frame', 'nokey'] : []),
    '-f', 'h264', '-i', 'pipe:0', '-map', '0:v:0', '-frames:v', '1',
    '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1' ]
  const out = spawnSync(ffmpeg, args, {
    input: buffer, timeout: 9000, maxBuffer: 6 * 1024 * 1024,
    windowsHide: true, encoding: null
  })
  const jpeg = out.stdout
  const valid = out.status === 0 && !out.error && Buffer.isBuffer(jpeg) &&
    jpeg.length >= 100 && jpeg.length <= MAX_JPEG &&
    jpeg[0] === 0xff && jpeg[1] === 0xd8 &&
    jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9
  return { jpeg: valid ? jpeg : null, reason: valid ? 'OK' : ffmpegCategory(out) }
}

function decodeFirstJpeg(h264, ffmpeg = 'ffmpeg') {
  const stats = inspectH264(h264)
  if (!stats.sps || !stats.pps || !stats.idr) {
    const e = new Error('NO_SPS_PPS_IDR_IN_H264'); e.category = e.message; throw e
  }
  // Try first keyframe; if a partial GOP at the start disrupts decode,
  // retry with an IDR-aligned stream. All attempts stay memory-only.
  const aligned = fromFirstIdr(h264)
  const attempts = [[h264, true], ...(aligned ? [[aligned, false]] : [])]
  let reason = 'NO_DECODABLE_FRAME'
  for (const [input, keyOnly] of attempts) {
    const res = tryDecode(input, ffmpeg, keyOnly)
    if (res.jpeg) return res.jpeg
    reason = res.reason
  }
  const e = new Error('FFMPEG_FRAME_DECODE_FAILED')
  e.category = reason
  throw e
}

module.exports = { decodeFirstJpeg, inspectH264 }
