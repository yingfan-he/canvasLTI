/**
 * Canvas LTI 1.3 demo: shows the launching user's name and email from the LTI id token.
 * Uses ltijs for the OIDC + JWT validation flow.
 */

require('dotenv').config()

const lti = require('ltijs').Provider

const PORT = Number(process.env.PORT || 3000)
const ENCRYPTION_KEY = process.env.LTI_ENCRYPTION_KEY

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 16) {
  console.error('Set LTI_ENCRYPTION_KEY in .env to a long random string (16+ characters).')
  process.exit(1)
}

const isProd = process.env.NODE_ENV === 'production'
const devMode =
  process.env.LTI_DEV_MODE !== undefined
    ? process.env.LTI_DEV_MODE === 'true'
    : !isProd

async function resolveMongoUri () {
  if (process.env.MONGODB_URI === 'memory') {
    const { MongoMemoryServer } = require('mongodb-memory-server')
    const mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    process.on('SIGINT', () => {
      mongod.stop().catch(() => {})
    })
    process.on('SIGTERM', () => {
      mongod.stop().catch(() => {})
    })
    console.log('Using in-memory MongoDB (MONGODB_URI=memory)')
    return uri
  }
  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ltijs_canvas_demo'
}

function escapeHtml (value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function displayName (userInfo) {
  if (!userInfo) return '—'
  if (userInfo.name) return userInfo.name
  const parts = [userInfo.given_name, userInfo.family_name].filter(Boolean)
  return parts.length ? parts.join(' ') : '—'
}

async function bootstrap () {
  const mongoUri = await resolveMongoUri()

  lti.setup(
    ENCRYPTION_KEY,
    { url: mongoUri },
    {
      appRoute: '/',
      loginRoute: '/login',
      cookies: {
        secure: isProd,
        sameSite: isProd ? 'None' : ''
      },
      devMode,
      serverAddon: (app) => {
        app.get('/health', (_req, res) => res.json({ ok: true }))
      }
    }
  )

  lti.onConnect((token, _req, res) => {
    const userInfo = token.userInfo || {}
    const name = displayName(userInfo)
    const email = userInfo.email

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LTI user</title>
  <style>
    :root { font-family: system-ui, sans-serif; background: #0f1419; color: #e7e9ea; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
    main { background: #16181c; border: 1px solid #2f3336; border-radius: 12px; padding: 1.75rem 2rem; max-width: 28rem; width: 100%; box-shadow: 0 8px 32px rgba(0,0,0,.35); }
    h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 1.25rem; color: #f7f9f9; }
    dl { margin: 0; display: grid; gap: 0.75rem; }
    dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #71767b; margin: 0; }
    dd { margin: 0.2rem 0 0; font-size: 1.05rem; word-break: break-word; }
    .hint { margin-top: 1.25rem; font-size: 0.85rem; color: #71767b; line-height: 1.45; }
    a { color: #1d9bf0; }
  </style>
</head>
<body>
  <main>
    <h1>Signed in via LTI</h1>
    <dl>
      <div>
        <dt>Name</dt>
        <dd>${escapeHtml(name)}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>${email ? escapeHtml(email) : '<em style="color:#71767b">Not in launch (Canvas may hide email)</em>'}</dd>
      </div>
    </dl>
    <p class="hint">Values come from the LTI 1.3 ID token (<code>userInfo</code> in ltijs). If email is empty, check the course/tool privacy settings and the developer key scopes in Canvas.</p>
  </main>
</body>
</html>`

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.send(html)
  })

  lti.onUnregisteredPlatform((_req, res) => {
    res.status(401).type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Platform not registered</title></head>
<body style="font-family:system-ui;max-width:36rem;margin:2rem auto;line-height:1.5">
  <h1>Canvas is not registered in this tool yet</h1>
  <p>Set <code>CANVAS_PLATFORM_URL</code> (issuer URL, no trailing slash) and <code>CANVAS_CLIENT_ID</code> in <code>.env</code>, then restart the server so the platform can be registered.</p>
</body></html>`)
  })

  await lti.deploy({ port: PORT, silent: false })

  const platformUrl = process.env.CANVAS_PLATFORM_URL
  const clientId = process.env.CANVAS_CLIENT_ID

  if (platformUrl && clientId) {
    const base = platformUrl.replace(/\/$/, '')
    await lti.registerPlatform({
      url: base,
      name: process.env.CANVAS_PLATFORM_NAME || 'Canvas',
      clientId,
      authenticationEndpoint: `${base}/api/lti/authorize_redirect`,
      accesstokenEndpoint: `${base}/login/oauth2/token`,
      authConfig: {
        method: 'JWK_SET',
        key: `${base}/api/lti/security/jwks`
      }
    })
    console.log(`Registered LTI platform: ${base}`)
  } else {
    console.log(
      'Tip: set CANVAS_PLATFORM_URL and CANVAS_CLIENT_ID in .env, then restart, so launches from Canvas are accepted.'
    )
  }

  console.log(`Listening on http://127.0.0.1:${PORT}`)
  console.log(
    'Canvas Developer Key: Target Link URI = your public origin (e.g. ngrok). OpenID Initiation URL = /login, JWK Set URL = /keys'
  )
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
