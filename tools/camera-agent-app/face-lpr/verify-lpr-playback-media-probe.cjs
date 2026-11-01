'use strict'
const assert=require('node:assert/strict')
const net=require('node:net')
const crypto=require('node:crypto')
const path=require('node:path')
const { probePlaybackMedia, videoTrack }=require('./lpr-playback-media-probe.cjs')
const { readConfig }=require('./config.cjs')
const md5=x=>crypto.createHash('md5').update(x).digest('hex')
const pwd='mock-secret'
function attrs(auth) {
  if (!/^Digest\s/i.test(auth||'')) return null
  return Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map(x=>[x[1],x[2]??x[3]]))
}
function mock({noPackets=false, rejectAuth=false}={}) {
  const server=net.createServer(socket=>{
    const nonce=crypto.randomBytes(9).toString('hex')
    let buff='',stage=0,session='mockSession123'
    function reply(code,cseq,additional='',body='') { socket.write(`RTSP/1.0 ${code} ${code===200?'OK':'Unauthorized'}\r\nCSeq: ${cseq}\r\n${additional}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`) }
    function packet() {
      const pkt=Buffer.alloc(12+32,0x33)
      pkt[0]=0x80; pkt[1]=96
      const out=Buffer.alloc(4+pkt.length)
      out[0]=0x24; out[1]=0; out.writeUInt16BE(pkt.length,2); pkt.copy(out,4)
      return out
    }
    socket.on('data',data=>{
      buff+=data.toString('latin1')
      while(buff.includes('\r\n\r\n')) {
        const cut=buff.indexOf('\r\n\r\n'), request=buff.slice(0,cut)
        buff=buff.slice(cut+4)
        const [first,...hdr]=request.split('\r\n')
        const m=/^(DESCRIBE|SETUP|PLAY|TEARDOWN) (rtsp:\/\/\S+) RTSP\/1\.0$/.exec(first)
        if (!m) {socket.destroy();return}
        const [,method,uri]=m
        const headers=Object.fromEntries(hdr.map(x=>{let i=x.indexOf(':');return [x.slice(0,i).toLowerCase(),x.slice(i+1).trim()]}))
        const auth=attrs(headers.authorization)
        const ha1=md5(`admin:MockNVR:${pwd}`), ha2=md5(`${method}:${uri}`)
        const valid=auth && auth.nonce===nonce && auth.uri===uri && auth.response===md5(`${ha1}:${nonce}:${ha2}`) && !rejectAuth
        const cseq=headers.cseq || '0'
        if (!valid) { reply(401,cseq,`WWW-Authenticate: Digest realm="MockNVR", nonce="${nonce}", algorithm=MD5\r\n`);continue }
        if (method==='DESCRIBE') {
          stage=1
          const sdp='v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=Mock\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=control:trackID=0\r\n'
          reply(200,cseq,'Content-Type: application/sdp\r\n',sdp)
        } else if (method==='SETUP') {
          assert.equal(stage,1); assert.match(uri,/trackID=0/)
          assert.match(headers.transport,/RTP\/AVP\/TCP/)
          stage=2
          reply(200,cseq,`Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\nSession: ${session};timeout=30\r\n`)
        } else if (method==='PLAY') {
          assert.equal(stage,2);assert.equal(headers.session,session)
          stage=3;reply(200,cseq,`Session: ${session}\r\n`)
          if (!noPackets) setTimeout(()=>{if(!socket.destroyed) socket.write(Buffer.concat([packet(),packet(),packet(),packet(),packet()]))},30)
        } else if (method==='TEARDOWN') {
          assert.equal(stage,3);assert.equal(headers.session,session)
          stage=4;reply(200,cseq)
        }
      }
    })
  })
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)))
}
async function main() {
  const config=readConfig(path.join(__dirname,'pilot.config.json'))
  assert.equal(config.enabled,false)
  assert.equal(config.nvrs.find(x=>x.id==='yakang-nvr-01').enabled,false)
  const opts={host:'127.0.0.1',port:0,allowLoopback:true,uiChannel:6,startTime:'2026_10_31_12_34_10',endTime:'2026_10_31_12_34_20',username:'admin',password:pwd,timeoutMs:3500,captureMs:600,maxRtpPackets:3}
  assert.throws(()=>probePlaybackMedia({...opts,host:'8.8.8.8'}),/PRIVATE_IPV4_REQUIRED/)
  assert.throws(()=>videoTrack('v=0\r\nm=video 0 RTP\/AVP 96\r\na=control:rtsp:\/\/8.8.8.8\/bad\r\n',{},'rtsp://127.0.0.1:554/cam/playback','127.0.0.1',554),/SAME_HOST/)
  console.log('PASS: private target validation, same-host track control, pilot disabled')
  const s=await mock()
  try {
    const r=await probePlaybackMedia({...opts,port:s.address().port})
    assert.equal(r.sameTcpDigest,true)
    assert.equal(r.describeStatus,200)
    assert.equal(r.videoSdp,true)
    assert.equal(r.codec,'H264')
    assert.equal(r.setupStatus,200)
    assert.equal(r.playStatus,200)
    assert.equal(r.rtpPackets,3)
    assert.ok(r.rtpPayloadBytes>0)
    assert.equal(r.teardownSent,true)
    assert.equal(r.teardownStatus,200)
    console.log('PASS: same-TCP Digest DESCRIBE, SETUP, PLAY, RTP receipt, TEARDOWN')
    const invalid=await probePlaybackMedia({...opts,port:s.address().port,password:'wrong'})
    assert.equal(invalid.describeStatus,401)
    assert.equal(invalid.playStatus,null)
    assert.equal(invalid.rtpPackets,0)
    console.log('PASS: incorrect secret rejected before SETUP/PLAY')
  } finally { await new Promise(resolve=>s.close(resolve)) }
  const absent=await mock({noPackets:true})
  try {
    const r=await probePlaybackMedia({...opts,port:absent.address().port})
    assert.equal(r.playStatus,200)
    assert.equal(r.rtpPackets,0)
    assert.equal(r.teardownSent,true)
    assert.equal(r.teardownStatus,200)
    console.log('PASS: PLAY 200 without media does not count as confirmed recording; TEARDOWN still sent')
  } finally {await new Promise(resolve=>absent.close(resolve))}
  console.log('LPR_MEDIA_OFFLINE_TEST: PASS')
  console.log('REAL_NVR_REQUEST_SENT: NO')
  console.log('MEDIA_SAVED: NO')
  console.log('SERVER_UPLOAD: NO')
  console.log('AGENT_MAIN_CHANGED: NO')
}
main().catch(e=>{console.error('LPR_MEDIA_OFFLINE_TEST: FAIL',e.message);process.exitCode=1})
