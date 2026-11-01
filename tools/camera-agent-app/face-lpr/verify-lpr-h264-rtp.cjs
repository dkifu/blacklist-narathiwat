'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { H264RtpCollector, parseRtp, sdpParameterSets } = require('./lpr-h264-rtp.cjs')

function splitAnnexB(raw) {
  const starts=[]
  for (let i=0; i+3<raw.length; i++) {
    if (raw[i] === 0 && raw[i+1] === 0 && (raw[i+2] === 1 || raw[i+2] === 0 && raw[i+3] === 1)) {
      const n=raw[i+2] === 1 ? 3 : 4
      starts.push([i,n]); i += n-1
    }
  }
  return starts.map(([s,n],i)=>raw.subarray(s+n, i+1<starts.length ? starts[i+1][0] : raw.length)).filter(x=>x.length)
}
function rtp(nal, seq, timestamp, { extension=false, padding=false, ssrc=0x1234 }={}) {
  const base=Buffer.alloc(12)
  base[0]=0x80 | (extension?0x10:0) | (padding?0x20:0)
  base[1]=96
  base.writeUInt16BE(seq & 65535, 2)
  base.writeUInt32BE(timestamp >>> 0,4)
  base.writeUInt32BE(ssrc,8)
  const ext=extension ? Buffer.from([0,0,0,1,1,2,3,4]) : Buffer.alloc(0)
  const pad=padding ? Buffer.from([0,0,0,4]) : Buffer.alloc(0)
  return Buffer.concat([base,ext,nal,pad])
}
function packetize(nals, mtu=500) {
  let seq=65530, ts=90000
  const packets=[]
  for (const nal of nals) {
    if (nal.length <= mtu) packets.push(rtp(nal,seq++,ts))
    else {
      const header=nal[0], size=mtu-2, total=nal.length-1
      for (let i=0; i<total; i+=size) {
        const first = i===0, last=i+size>=total
        const fu=Buffer.concat([Buffer.from([(header & 0xe0)|28, (first?0x80:0)|(last?0x40:0)|(header&31)]),nal.subarray(1+i,1+i+size)])
        packets.push(rtp(fu,seq++,ts))
      }
    }
    ts+=18000
  }
  return packets
}
function imageFromH264(raw) {
  const r=spawnSync('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-f','h264','-framerate','5','-i','pipe:0','-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'],
    {input:raw,timeout:12000,maxBuffer:5*1024*1024,windowsHide:true})
  if (r.error) throw new Error('FFMPEG_DECODER_UNAVAILABLE')
  if (r.status !== 0) throw new Error('FFMPEG_DECODE_FAILED')
  assert.ok(r.stdout.length > 200)
  assert.equal(r.stdout[0],0xff)
  assert.equal(r.stdout[1],0xd8)
  assert.equal(r.stdout.at(-2),0xff)
  assert.equal(r.stdout.at(-1),0xd9)
  return r.stdout.length
}
function main() {
  const raw=fs.readFileSync(path.join(__dirname,'fixtures','synthetic-lpr-test.h264'))
  const nals=splitAnnexB(raw)
  assert.ok(nals.length>=5)
  const sps=nals.find(x=>(x[0]&31)===7),pps=nals.find(x=>(x[0]&31)===8)
  assert.ok(sps&&pps)
  const coll=new H264RtpCollector({ expectedPayloadType:96,maxBytes:1024*1024 })
  const packets=packetize(nals,360)
  for(const packet of packets) assert.equal(coll.push(packet),true)
  const stats=coll.summary()
  assert.equal(stats.rtpPackets,packets.length)
  assert.equal(stats.nals,nals.length)
  assert.equal(stats.hasSps,true)
  assert.equal(stats.hasPps,true)
  assert.equal(stats.hasIdr,true)
  assert.equal(stats.incompleteFu,false)
  assert.ok(stats.rtpPackets>stats.nals,'FU-A was not tested')
  assert.ok(imageFromH264(coll.take()) > 200)
  console.log('PASS: H264 single-NAL and fragmented FU-A assemble to decodable JPEG via FFmpeg')

  const stap=Buffer.concat([Buffer.from([24,0,sps.length]),sps,Buffer.from([0,pps.length]),pps])
  const coll2=new H264RtpCollector({sdp:'a=fmtp:96 packetization-mode=1;sprop-parameter-sets='+sps.toString('base64')+','+pps.toString('base64'), expectedPayloadType:96})
  assert.equal(coll2.hasSps,true)
  assert.equal(coll2.hasPps,true)
  coll2.push(rtp(stap,100,90000,{extension:true,padding:true}))
  assert.equal(coll2.summary().nals,4)
  assert.equal(parseRtp(rtp(stap,100,90000,{extension:true,padding:true})).payload.equals(stap),true)
  assert.equal(sdpParameterSets('a=fmtp:96 sprop-parameter-sets='+sps.toString('base64')+','+pps.toString('base64')).length,2)
  console.log('PASS: SDP parameter sets, STAP-A, RTP header extension and padding')

  const large=nals.find(x=>x.length>360)
  assert.ok(large)
  const lost=packetize([large],150)
  assert.ok(lost.length>2)
  const coll3=new H264RtpCollector({expectedPayloadType:96})
  coll3.push(lost[0]); for(let i=2;i<lost.length;i++) coll3.push(lost[i])
  assert.equal(coll3.summary().nals,0)
  assert.ok(coll3.summary().discarded>0)
  assert.equal(coll3.take().length,0)
  assert.equal(coll3.push(Buffer.from([1,2,3])),false)
  assert.equal(coll3.push(rtp(Buffer.from([0x65,1,2]),15,1,{ssrc:999})),false)
  assert.throws(()=>new H264RtpCollector({maxBytes:100}),/BAD_LIMIT/)
  console.log('PASS: sequence gaps discard incomplete FU-A; malformed RTP and SSRC changes rejected')

  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'pilot.config.json'),'utf8'))
  assert.equal(config.enabled,false)
  assert.ok(config.nvrs.every(x=>x.enabled===false))
  console.log('PASS: pilot remains disabled; synthetic fixture contains no CCTV or personal data')
  console.log('LPR_H264_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
}
try { main() } catch (e) { console.error('LPR_H264_OFFLINE_TEST: FAIL',e.message); process.exitCode=1 }
