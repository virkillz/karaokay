import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME } from '../shared/ipc'
import type { Library, MediaRoleFile } from './library/library'

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ])
}

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.srt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

/** Parse "bytes=a-b" against a file size. Returns null for no/unsupported range. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number
  let end: number
  if (m[1] === '') {
    // suffix: last N bytes
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || end < start) return 'invalid'
  return { start, end }
}

/** Serve a file with byte-range support (video elements seek with Range requests). */
async function serveRanged(file: string, req: Request, headers: Record<string, string>, type: string): Promise<Response> {
  const { size } = await fs.stat(file)
  const range = parseRange(req.headers.get('range'), size)
  const base = { ...headers, 'Content-Type': type, 'Accept-Ranges': 'bytes' }
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
  if (!range) {
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } })
  }
  const body = Readable.toWeb(createReadStream(file, { start: range.start, end: range.end })) as ReadableStream
  return new Response(body, {
    status: 206,
    headers: { ...base, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` }
  })
}

/** karaokay-media://song/<id>/<role>: files are resolved through the database only. */
export function handleMediaProtocol(library: Library, picked: Map<string, string>): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
    try {
      const url = new URL(req.url)
      const [id, role] = url.pathname.replace(/^\//, '').split('/').map(decodeURIComponent)
      if (url.hostname === 'picked') {
        const file = picked.get(id)
        if (!file) return new Response('not found', { status: 404, headers })
        const res = await net.fetch(pathToFileURL(file).toString())
        return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/octet-stream' } })
      }
      if (url.hostname !== 'song' || !id || !['instrumental', 'vocals', 'lyrics', 'cover', 'video'].includes(role)) {
        return new Response('bad request', { status: 400, headers })
      }
      const file = library.filePath(id, role as MediaRoleFile)
      if (!file) return new Response('not found', { status: 404, headers })
      if (role === 'video') {
        const vext = file.slice(file.lastIndexOf('.')).toLowerCase()
        return await serveRanged(file, req, headers, TYPES[vext] ?? 'application/octet-stream')
      }
      const res = await net.fetch(pathToFileURL(file).toString())
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
      return new Response(res.body, {
        status: res.status,
        headers: { ...headers, 'Content-Type': TYPES[ext] ?? 'application/octet-stream' }
      })
    } catch (e) {
      return new Response(String(e), { status: 500, headers })
    }
  })
}
