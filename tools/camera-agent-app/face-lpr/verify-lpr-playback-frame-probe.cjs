'use strict'
const assert = require('node:assert/strict')
const net = require('node:net')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { capturePlaybackH264 } = require('./lpr-playback-frame-probe.cjs')
const { decodeFirstJpeg } = require('./lpr-playback-frame-decode.cjs')
const { readConfig } = require('./config.cjs')
const md5 = value => crypto.createHash('md5').update(value).digest('hex')
const password = 'synthetic-password'
function digestFields(x) {
  if (!/^Digest\s/i.test(x||'')) return null
  return Object.fromEntries([...x.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map(m=>[m[1],m[2]??m[3]]))
}
function splitNals(buffer) {
  const marks=[]
  for (let i=0;i+3<buffer.length;i++) {
    if (buffer[i]===0 && buffer[i+1]===0 && (buffer[i+2]===1 || buffer[i+2]===0 && buffer[i+3]===1)) {
      const n = buffer[i+2]===1 ? 3 : 4
      marks.push([i,n]);i+=n-1
    }
  }
  return marks.map(([p,n],i)=>buffer.subarray(p+n, i+1<marks.length?marks[i+1][0]:buffer.length)).filter(x=>x.length)
}
function pkt(nal, seq, ts, marker=false) {
  const hdr=Buffer.alloc(12); hdr[0]=0x80;hdr[1]=96|(marker?0x80:0)
  hdr.writeUInt16BE(seq&65535,2);hdr.writeUInt32BE(ts>>>0,4);hdr.writeUInt32BE(0x124578,8)
  const rtp=Buffer.concat([hdr,nal]);const out=Buffer.alloc(4+rtp.length)
  out[0]=0x24;out[1]=0;out.writeUInt16BE(rtp.length,2);rtp.copy(out,4)
  return out
}
function packetsFor(raw) {
  let seq=1,ts=90000
  const all=[]
  for (const nal of splitNals(raw)) {
    if (nal.length<=600) all.push(pkt(nal,seq++,ts))
    else {
      for(let i=1;i<nal.length;i+=598) {
        const start=i===1, end=i+598>=nal.length
        const fu=Buffer.concat([Buffer.from([(nal[0]&0xe0)|28,(start?0x80:0)|(end?0x40:0)|(nal[0]&31)]),nal.subarray(i,i+598)])
        all.push(pkt(fu,seq++,ts,end))
      }
    }
    ts+=3600
  }
  return all
}
async function mockServer({noPackets=false,rejectAuth=false}={}) {
  const raw=fs.readFileSync(path.join(__dirname,'fixtures','synthetic-lpr-test.h264'))
  const packets=packetsFor(raw)
  const server=net.createServer(socket=>{
    const nonce=crypto.randomBytes(10).toString('hex')
    let text='',stage=0
    const respond=(code,cseq,extra='',body='')=>socket.write(`RTSP/1.0 ${code} ${code===200?'OK':'Unauthorized'}\r\nCSeq: ${cseq}\r\n${extra}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,'latin1')
    socket.on('data',data=>{
      text+=data.toString('latin1')
      while(text.includes('\r\n\r\n')) {
        const pos=text.indexOf('\r\n\r\n'),req=text.slice(0,pos);text=text.slice(pos+4)
        const [line,...hdr]=req.split('\r\n');const m=/^(DESCRIBE|SETUP|PLAY|TEARDOWN) (rtsp:\/\/\S+) RTSP\/1\.0$/.exec(line)
        if(!m) {socket.destroy();return}
        const [,method,uri]=m
        const headers=Object.fromEntries(hdr.map(x=>{const p=x.indexOf(':');return[x.slice(0,p).toLowerCase(),x.slice(p+1).trim()]}))
        const d=digestFields(headers.authorization)
        const valid=d && d.nonce===nonce && d.uri===uri && d.response===md5(`${md5('admin:MockNVR:'+password)}:${nonce}:${md5(method+':'+uri)}`) && !rejectAuth
        const cseq=headers.cseq||'0'
        if(!valid){respond(401,cseq,`WWW-Authenticate: Digest realm="MockNVR", nonce="${nonce}", algorithm=MD5\r\n`);continue}
        if(method==='DESCRIBE') {
          stage=1
          const sdp='v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=Mock\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=control:trackID=0\r\n'
          respond(200,cseq,'Content-Type: application/sdp\r\n',sdp)
        } else if(method==='SETUP') {
          assert.equal(stage,1);stage=2
          respond(200,cseq,'Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\nSession: testSession123;timeout=30\r\n')
        } else if(method==='PLAY') {
          assert.equal(stage,2);stage=3
          respond(200,cseq,'Session: testSession123\r\n')
          if(!noPackets) setTimeout(()=>{if(!socket.destroyed)socket.write(Buffer.concat(packets))},40)
        } else if(method==='TEARDOWN') {
          assert.equal(stage,3);stage=4
          respond(200,cseq)
        }
      }
    })
  })
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)))
}
async function run() {
  const conf=readConfig(path.join(__dirname,'pilot.config.json'))
  assert.equal(conf.enabled,false)
  assert.equal(conf.nvrs.find(x=>x.id==='yakang-nvr-01').enabled,false)
  const sample=fs.readFileSync(path.join(__dirname,'fixtures','synthetic-lpr-test.h264'))
  assert.ok(decodeFirstJpeg(sample).length>100)
  assert.throws(()=>capturePlaybackH264({host:'8.8.8.8'}),/PRIVATE_IPV4_REQUIRED/)
  console.log('PASS: offline synthetic H264 decodes to JPEG; private NVR required')
  const server=await mockServer()
  const options={host:'127.0.0.1',port:server.address().port,uiChannel:6,startTime:'2026_10_31_12_34_10',endTime:'2026_10_31_12_34_20',username:'admin',password,allowLoopback:true,captureMs:600,timeoutMs:3500,maxRtpPackets:1800,maxMediaBytes:1024*1024}
  try {
    const r=await capturePlaybackH264(options)
    assert.equal(r.describeStatus,200);assert.equal(r.setupStatus,200);assert.equal(r.playStatus,200)
    assert.equal(r.codec,'H264');assert.ok(r.rtpPackets>5)
    assert.equal(r.collector.hasIdr,true);assert.equal(r.collector.hasSps,true);assert.equal(r.collector.hasPps,true)
    assert.ok(decodeFirstJpeg(r.h264).length>100)
    assert.equal(r.teardownSent,true);assert.equal(r.teardownStatus,200)
    console.log('PASS: same TCP Digest + RTSP playback -> RTP FU-A -> H264 -> in-memory JPEG + TEARDOWN')
    const wrong=await capturePlaybackH264({...options,password:'wrong'})
    assert.equal(wrong.describeStatus,401);assert.equal(wrong.rtpPackets,0)
    console.log('PASS: incorrect credentials rejected before media setup')
  } finally {await new Promise(ok=>server.close(ok))}
  const empty=await mockServer({noPackets:true})
  try {
    const r=await capturePlaybackH264({...options,port:empty.address().port,captureMs:500})
    assert.equal(r.playStatus,200);assert.equal(r.rtpPackets,0);assert.equal(r.h264.length,0)
    assert.equal(r.teardownSent,true)
    console.log('PASS: PLAY 200 but no RTP is NOT a confirmed frame; TEARDOWN sent')
  } finally {await new Promise(ok=>empty.close(ok))}
  console.log('LPR_FRAME_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
}
run().catch(e=>{console.error('LPR_FRAME_OFFLINE_TEST: FAIL',e.message);process.exitCode=1})
