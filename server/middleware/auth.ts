import { Request, Response, NextFunction } from 'express'
import { verifyEd25519Signature, verifyWebAuthnSignature } from '../../src/lib/crypto.js'

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
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
