const util = require('util')
const { Writable } = require('stream')
const zlib = require('zlib')

// width (int32bs), height (int32bs), spp (int32bs), renderTime (int64bs)
const expectedHeaderCount = 4 + 4 + 4 + 8

function DumpCheckStream (options) {
  Writable.call(this, options)
  this.headerCount = 0
  this.header = []
  this.bodyCount = 0
}
util.inherits(DumpCheckStream, Writable)

DumpCheckStream.prototype._write = function (chunk, enc, cb) {
  if (this.headerCount < expectedHeaderCount) {
    const headerPart = chunk.slice(0, Math.max(0, expectedHeaderCount - this.headerCount))
    if (headerPart.length > 0) {
      this.headerCount += headerPart.length
      this.header.push(headerPart)
    }
    this.bodyCount += chunk.length - headerPart.length
  } else {
    this.bodyCount += chunk.length
  }

  if (this.headerCount === expectedHeaderCount && this.width == null && this.height == null) {
    const header = this.header[0].length >= 20 ? this.header[0] : Buffer.concat(this.header)
    this.width = header.readInt32BE(0)
    this.height = header.readInt32BE(4)
    this.spp = header.readInt32BE(8)
    this.renderTime = header.readIntBE(12, 8, true)
    this.emit('dump header')
  }

  cb()
}

Object.defineProperty(DumpCheckStream.prototype, 'valid', {
  get: function () {
    return this.headerCount === expectedHeaderCount && this.bodyCount === this.width * this.height * 3 * 8
  }
})

/**
 * Reads the dump header.
 */
const getDumpInfo = (dumpStream) => new Promise((resolve, reject) => {
  const ws = new DumpCheckStream()
  ws.on('dump header', () => {
    resolve({
      width: ws.width,
      height: ws.height,
      spp: ws.spp,
      renderTime: ws.renderTime
    })
  })
  const gzipStream = dumpStream.pipe(zlib.createGunzip())
  gzipStream.on('end', () => {
    if (ws.headerCount < expectedHeaderCount) {
      reject(new Error('Invalid dump stream'))
    }
  })
  gzipStream.pipe(ws)
})

/**
 * Like `getDumpInfo`, but reads the entire dump to check if its length is correct.
 */
const getValidatedDumpInfo = (dumpStream) => new Promise((resolve, reject) => {
  const ws = new DumpCheckStream()
  const gzipStream = dumpStream.pipe(zlib.createGunzip())
  gzipStream.on('end', () => {
    if (ws.valid) {
      resolve({
        width: ws.width,
        height: ws.height,
        spp: ws.spp,
        renderTime: ws.renderTime
      })
    } else {
      reject(new Error('Invalid dump stream'))
    }
  })
  gzipStream.pipe(ws)
})

module.exports = {
  getDumpInfo,
  getValidatedDumpInfo
}
