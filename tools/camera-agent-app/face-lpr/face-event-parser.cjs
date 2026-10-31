'use strict'

// Incremental parser for Dahua eventManager multipart event output.
// This module does not communicate with an NVR and does not log personal data.

const { StringDecoder } = require('node:string_decoder')
const MAX_BUFFER = 256 * 1024

function parseEventFrame(lines) {
  const first = lines.findIndex(line => line.startsWith('Code='))
  if (first < 0) return null
  const header = lines[first]
  const match = /^Code=([^;\r\n]+);action=([^;\r\n]+);index=(\d+);data=([\s\S]*)$/.exec(header)
  if (!match) throw new Error('INVALID_EVENT_HEADER')
  const [, code, action, indexText, firstData] = match
  if (!['Pulse', 'Start', 'Stop'].includes(action)) throw new Error('UNSUPPORTED_ACTION')
  const index = Number(indexText)
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('INVALID_CHANNEL_INDEX')
  const jsonText = [firstData, ...lines.slice(first + 1)].join('\n').trim()
  if (!jsonText) throw new Error('EMPTY_EVENT_DATA')
  let data
  try { data = JSON.parse(jsonText) } catch { throw new Error('INVALID_EVENT_JSON') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('INVALID_EVENT_OBJECT')
  }
  return { code, action, index, channel: index + 1, data }
}

class FaceEventParser {
  constructor({ onEvent, onHeartbeat = () => {}, onMalformed = () => {} } = {}) {
    if (typeof onEvent !== 'function') throw new Error('ON_EVENT_REQUIRED')
    this.onEvent = onEvent
    this.onHeartbeat = onHeartbeat
    this.onMalformed = onMalformed
    this.decoder = new StringDecoder('utf8')
    this.pending = ''
    this.frame = []
    this.frameSize = 0
    this.discardFrame = false
  }

  _malformed(reason) {
    this.onMalformed(reason)
  }

  _flush() {
    if (!this.frame.length) { this.discardFrame = false; return }
    const lines = this.frame
    const discard = this.discardFrame
    this.frame = []
    this.frameSize = 0
    this.discardFrame = false
    if (discard) return
    try {
      const event = parseEventFrame(lines)
      // Never forward unrelated NVR event types.
      if (event && event.code === 'FaceComparision') this.onEvent(event)
    } catch (err) {
      this._malformed(err.message)
    }
  }

  _line(raw) {
    const line = raw.replace(/\r$/, '')
    const trimmed = line.trim()
    if (/^--[a-zA-Z0-9_-]+(?:--)?$/.test(trimmed)) {
      this._flush()
      return
    }
    if (trimmed === 'Heartbeat' || trimmed === 'data: Heartbeat') {
      this._flush()
      this.onHeartbeat()
      return
    }
    if (line.startsWith('Code=')) {
      this._flush()
      this.frame = [line]
      this.discardFrame = false
      this.frameSize = line.length
      return
    }
    if (!this.frame.length || this.discardFrame) return
    this.frameSize += line.length + 1
    if (this.frameSize > MAX_BUFFER) {
      this.discardFrame = true
      this.frame = []
      this._malformed('FRAME_TOO_LARGE')
      return
    }
    this.frame.push(line)
  }

  push(chunk) {
    const text = Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk)
    if (text.length > MAX_BUFFER) {
      this.pending = ''
      this.frame = []
      this.frameSize = 0
      this.discardFrame = true
      this._malformed('CHUNK_TOO_LARGE')
      return
    }
    this.pending += text
    if (this.pending.length > MAX_BUFFER) {
      this.pending = ''
      this.frame = []
      this.frameSize = 0
      this.discardFrame = true
      this._malformed('LINE_TOO_LARGE')
      return
    }
    for (;;) {
      const end = this.pending.indexOf('\n')
      if (end < 0) break
      const line = this.pending.slice(0, end)
      this.pending = this.pending.slice(end + 1)
      this._line(line)
    }
  }

  end() {
    this.pending += this.decoder.end()
    if (this.pending) this._line(this.pending)
    this.pending = ''
    this._flush()
  }
}

module.exports = { FaceEventParser, parseEventFrame }
