import he from 'he'

type AuthTone = 'success' | 'error'

const toneColor: Record<AuthTone, string> = {
  success: '#4ade80',
  error: '#f87171'
}

export function renderAuthPage(title: string, message: string, tone: AuthTone): string {
  return `
    <html>
      <body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;">
        <h1 style="color:${toneColor[tone]}">${he.escape(title)}</h1>
        <p>${he.escape(message)}</p>
      </body>
    </html>
  `
}
