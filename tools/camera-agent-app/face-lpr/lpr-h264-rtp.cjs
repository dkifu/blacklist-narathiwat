'use strict'

// Isolated, dependency-free H.264-over-RTP parser for Stage 20 pilot.
// Supported RFC 6184 packetization: single NAL (1..23), STAP-A (24), FU-A (28).
// This module never opens sockets, reads credentials, writes images or modifies Agents.

const START = Buffer.from([0, 0, 0, 1])

function parseRtp(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 12 || (packet[0] >> 6) !== 2) return null
  const csrc = packet[0] & 15
  let offset = 12 + 4 * csrc
  if (packet.length < offset) return null
  if (packet[0] & 0x10) {
    if (packet.length < offset + 4) return null
    const extensionWords = packet.readUInt16BE(offset + 2)
    offset += 4 + extensionWords * 4
    if (packet.length < offset) return null
  }
  let end = packet.length
  if (packet[0] & 0x20) {
    const pad = packet[end - 1]
    if (!pad || end - pad < offset) return null
    end -= pad
  }
  if (end <= offset) return null
  return {
    payload: packet.subarray(offset, end),
    sequence: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    payloadType: packet[1] & 127,
    marker: !!(packet[1] & 0x80),
  }
}

function sdpParameterSets(sdp) {
  if (typeof sdp !== 'string') return []
  const match = /(?:^|[;\s])sprop-parameter-sets=([^;\r\n\s]+)/i.exec(sdp)
  if (!match) return []
  const parts = match[1].split(',')
  if (parts.length > 4) return []
  const out = []
  for (const part of parts) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(part) || part.length > 4096) return []
    const bytes = Buffer.from(part, 'base64')
    if (!bytes.length || bytes.length > 3072 || bytes[0] & 0x80) return []
    out.push(bytes)
  }
  return out
}

class H264RtpCollector {
  constructor({ maxBytes = 8 * 1024 * 1024, expectedPayloadType = null, sdp = '' } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 32 * 1024 * 1024) throw new Error('H264_BAD_LIMIT')
    if (expectedPayloadType != null && (!Number.isInteger(expectedPayloadType) || expectedPayloadType < 0 || expectedPayloadType > 127)) throw new Error('H264_BAD_PAYLOAD_TYPE')
    this.maxBytes = maxBytes
    this.expectedPayloadType = expectedPayloadType
    this.parts = []
    this.bytes = 0
    this.nals = 0
    this.rtpPackets = 0
    this.discarded = 0
    this.fu = null
    this.lastSeq = null
    this.ssrc = null
    this.lastTs = null
    this.firstTs = null
    this.hasSps = false
    this.hasPps = false
    this.hasIdr = false
    for (const data of sdpParameterSets(sdp)) this._add(data)
  }
  _add(data) {
    if (!Buffer.isBuffer(data) || !data.length || (data[0] & 0x80)) { this.discarded++; return }
    const type = data[0] & 31
    if (type === 7) this.hasSps = true
    if (type === 8) this.hasPps = true
    if (type === 5) this.hasIdr = true
    if (this.bytes + data.length + 4 > this.maxBytes) throw new Error('H264_CAPTURE_LIMIT_REACHED')
    this.parts.push(START, Buffer.from(data))
    this.bytes += data.length + 4
    this.nals++
  }
  push(packet) {
    const r = parseRtp(packet)
    if (!r || this.expectedPayloadType != null && r.payloadType !== this.expectedPayloadType) { this.discarded++; return false }
    if (this.ssrc != null && this.ssrc !== r.ssrc) { this.discarded++; return false }
    this.ssrc = r.ssrc
    this.rtpPackets++
    if (this.firstTs == null) this.firstTs = r.timestamp
    this.lastTs = r.timestamp
    if (this.fu && this.lastSeq != null && ((this.lastSeq + 1) & 65535) !== r.sequence) {
      this.fu = null
      this.discarded++
    }
    this.lastSeq = r.sequence
    const payload = r.payload
    const type = payload[0] & 31
    if (type >= 1 && type <= 23) {
      this.fu = null
      this._add(payload)
    } else if (type === 24) {
      this.fu = null
      let i = 1
      while (i + 2 <= payload.length) {
        const length = payload.readUInt16BE(i)
        i += 2
        if (!length || i + length > payload.length) { this.discarded++; return false }
        this._add(payload.subarray(i, i + length))
        i += length
      }
      if (i !== payload.length) { this.discarded++; return false }
    } else if (type === 28 && payload.length >= 3) {
      const isStart = !!(payload[1] & 0x80)
      const isEnd = !!(payload[1] & 0x40)
      const originalType = payload[1] & 31
      if (!originalType || originalType > 23 || isStart && isEnd) { this.fu = null; this.discarded++; return false }
      if (isStart) {
        this.fu = { timestamp: r.timestamp, chunks: [Buffer.from([(payload[0] & 0xe0) | originalType]), Buffer.from(payload.subarray(2))], size: payload.length - 1 }
      } else if (!this.fu || this.fu.timestamp !== r.timestamp) {
        this.fu = null
        this.discarded++
        return false
      } else {
        this.fu.chunks.push(Buffer.from(payload.subarray(2)))
        this.fu.size += payload.length - 2
      }
      if (this.fu && this.bytes + this.fu.size + 4 > this.maxBytes) { this.fu = null; throw new Error('H264_CAPTURE_LIMIT_REACHED') }
      if (isEnd && this.fu) {
        const complete = Buffer.concat(this.fu.chunks, this.fu.size)
        this.fu = null
        this._add(complete)
      }
    } else {
      this.fu = null
      this.discarded++
      return false
    }
    return true
  }
  summary() {
    return { rtpPackets: this.rtpPackets, nals: this.nals, bytes: this.bytes,
      hasSps: this.hasSps, hasPps: this.hasPps, hasIdr: this.hasIdr,
      discarded: this.discarded, incompleteFu: !!this.fu,
      rtpTimestampSpan: this.firstTs == null ? null : ((this.lastTs - this.firstTs) >>> 0) }
  }
  take() { return Buffer.concat(this.parts, this.bytes) }
}

module.exports = { parseRtp, sdpParameterSets, H264RtpCollector }
