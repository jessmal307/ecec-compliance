// Printable A4 poster for a floor link. The QR code is generated here in the
// browser: the link is a secret, so it never goes to a QR service, and it is
// never printed as text.
export const POPUP_BLOCKED_MESSAGE = 'Allow pop-ups to print the poster.'
const POSTER_FAILED_MESSAGE = 'Could not build the poster. Try again.'

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function posterHtml(siteName, qrSvg) {
  const site = escapeHtml(siteName || 'Your centre')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Floor link poster — ${site}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #14303f;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: 180mm;
    min-height: 260mm;
    margin: 0 auto;
    padding: 10mm 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  h1 { font-size: 30pt; line-height: 1.15; margin: 0 0 4mm; }
  .lead { font-size: 15pt; margin: 0 0 8mm; color: #3d5663; }
  .qr { width: 115mm; height: 115mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  ol {
    list-style: none;
    padding: 0;
    margin: 10mm 0 0;
    display: flex;
    flex-direction: column;
    gap: 4mm;
    font-size: 18pt;
    text-align: left;
  }
  ol li { display: flex; align-items: center; gap: 5mm; }
  .num {
    flex: none;
    width: 11mm;
    height: 11mm;
    border-radius: 50%;
    background: #12855a;
    color: #fff;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .note {
    margin-top: 12mm;
    padding: 4mm 6mm;
    border: 0.6mm solid #14303f;
    border-radius: 3mm;
    font-size: 12pt;
    font-weight: 600;
  }
  .brand { margin-top: auto; padding-top: 10mm; font-size: 11pt; color: #3d5663; }
  @media screen { body { background: #eef1f3; } .sheet { background: #fff; margin: 8mm auto; padding: 15mm; width: 210mm; min-height: 297mm; } }
</style>
</head>
<body>
<main class="sheet">
  <h1>${site}</h1>
  <p class="lead">Today’s forms</p>
  <div class="qr">${qrSvg}</div>
  <ol>
    <li><span class="num">1</span>Scan this code with the tablet or phone camera</li>
    <li><span class="num">2</span>Pick your name</li>
    <li><span class="num">3</span>Enter your PIN</li>
  </ol>
  <p class="note">Keep this poster in a staff-only area — anyone with this code can open your forms.</p>
  <p class="brand">RoadToComply</p>
</main>
</body>
</html>`
}

// Must be called straight from a click, before any await, or the new tab is
// treated as a pop-up and blocked.
export function openFloorPoster({ siteName, url }) {
  const poster = window.open('', '_blank')
  if (!poster) return Promise.resolve({ error: { message: POPUP_BLOCKED_MESSAGE } })

  return import('qrcode')
    .then((QRCode) =>
      QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }),
    )
    .then((qrSvg) => {
      poster.document.open()
      poster.document.write(posterHtml(siteName, qrSvg))
      poster.document.close()
      poster.focus()
      poster.print()
      return { error: null }
    })
    .catch(() => {
      poster.close()
      return { error: { message: POSTER_FAILED_MESSAGE } }
    })
}
