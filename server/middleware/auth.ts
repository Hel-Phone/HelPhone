import { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { verifyEd25519Signature, verifyWebAuthnSignature } from '../../src/lib/crypto.js'

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const bearer = req.header('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1]
    if (bearer) {
      const parts = bearer.split('.')
      if (parts.length !== 3 || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        return res.status(401).json({ success: false, error: 'Invalid passkey session' })
      }
      const unsigned = `${parts[0]}.${parts[1]}`
      const expected = createHmac('sha256', process.env.SESSION_SECRET).update(unsigned).digest()
      const actual = Buffer.from(parts[2], 'base64url')
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return res.status(401).json({ success: false, error: 'Invalid passkey session' })
      }
      let header: { alg?: string }
      let claims: { sub?: string; username?: string; exp?: number }
      try {
        header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
        claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      } catch {
        return res.status(401).json({ success: false, error: 'Malformed passkey session' })
      }
      if (header.alg !== 'HS256' || !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) {
        return res.status(401).json({ success: false, error: 'Expired or invalid passkey session' })
      }
      ;(req as any).authenticatedUser = { id: claims.sub, username: claims.username, algorithm: 'webauthn' }
      return next()
    }

    const signature = req.header('X-Signature')
    const publicKey = req.header('X-Public-Key')
    const timestampStr = req.header('X-Timestamp')
    const algorithm = req.header('X-Algorithm') || 'ed25519'

    if (!signature || !publicKey || !timestampStr) {
      return res.status(401).json({
        success: false,
        error: 'Missing required cryptographic authentication headers (X-Signature, X-Public-Key, X-Timestamp)',
      })
    }

    // Anti-replay timestamp freshness check (max 5 minutes tolerance)
    const timestamp = parseInt(timestampStr, 10)
    const now = Date.now()
    if (isNaN(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return res.status(401).json({
        success: false,
        error: 'Request timestamp expired or outside freshness tolerance boundary',
      })
    }

    // Construct canonical payload string for verification
    const bodyStr = req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : ''
    const canonicalPayload = `${req.method}:${req.path}:${timestampStr}:${bodyStr}`

    let isValid = false

    if (algorithm === 'ed25519') {
      isValid = verifyEd25519Signature(canonicalPayload, signature, publicKey)
    } else if (algorithm === 'webauthn-p256') {
      const clientDataJSON = req.header('X-Client-Data-JSON') || ''
      const authenticatorData = req.header('X-Authenticator-Data') || ''
      const challenge = req.header('X-Expected-Challenge') || timestampStr

      if (!clientDataJSON || !authenticatorData) {
        return res.status(400).json({
          success: false,
          error: 'Missing WebAuthn headers (X-Client-Data-JSON, X-Authenticator-Data)',
        })
      }

      const webauthnRes = await verifyWebAuthnSignature(
        clientDataJSON,
        authenticatorData,
        signature,
        challenge,
        publicKey
      )
      isValid = webauthnRes.verified
    } else {
      return res.status(400).json({ success: false, error: `Unsupported algorithm: ${algorithm}` })
    }

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Cryptographic signature verification failed or payload tampered',
      })
    }

    ;(req as any).authenticatedUser = { publicKey, algorithm, timestamp }
    next()
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Auth verification failure' })
  }
}
