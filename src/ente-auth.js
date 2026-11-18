#!/usr/bin/osascript -l JavaScript
// Alfred workflow entry point for Ente Auth.
//   ente-auth.js list       Script Filter: every saved code (Alfred filters)
//   ente-auth.js code <id>  Run Script: current OTP as an alfredworkflow object
//   ente-auth.js live       Script Filter: auto-refreshing OTP with countdown
ObjC.import('Foundation')
ObjC.import('AppKit')

const DEFAULT_ENTE_PATH = '/opt/homebrew/bin/ente'
const LIST_CACHE_SECONDS = 300
// Codes closer than this to expiry are skipped in favour of the next one.
const MIN_REMAINING_SECONDS = 3
const BAR_WIDTH = 10
const ERROR_ICON = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/AlertStopIcon.icns'
const CURL_PATH = '/usr/bin/curl'

// Issuer icons follow the Ente Auth app (mobile/apps/auth/lib/ui/utils/icon_utils.dart),
// fetched from pinned commits. Bump with scripts/update-icon-sources.sh.
const ENTE_COMMIT = '8980b6acefa8e5b36214ecfa9dc3795b31a59464'
const SIMPLE_ICONS_COMMIT = '6dcfdc2f58f6150d7b097b5cab158d27413f6366'
const ICON_SOURCES = {
  custom: `https://raw.githubusercontent.com/ente-io/ente/${ENTE_COMMIT}/mobile/apps/auth/assets/custom-icons`,
  simple: `https://raw.githubusercontent.com/simple-icons/simple-icons/${SIMPLE_ICONS_COMMIT}`,
}
const ICON_INDEX_PATHS = { custom: '_data/custom-icons.json', simple: '_data/simple-icons.json' }
const ICON_SIZE = 128
const ICON_DOWNLOAD_TIMEOUT_SECONDS = 5
// Theme colors from mobile/apps/auth/lib/ente_theme_data.dart and lib/theme/colors.dart.
const THEME = {
  light: {
    iconColor: [0, 0, 0, 0.75],
    avatarColors: [
      [118, 84, 154], [223, 120, 97], [148, 180, 159], [135, 162, 251], [198, 137, 198], [198, 137, 198],
      [50, 82, 136], [133, 180, 224], [193, 163, 163], [193, 163, 163], [66, 97, 101], [66, 97, 101],
      [66, 97, 101], [221, 157, 226], [130, 171, 139], [155, 187, 232], [143, 190, 190], [138, 195, 161],
      [168, 176, 242], [176, 198, 149], [233, 154, 173], [209, 132, 132], [120, 181, 167],
    ],
  },
  dark: {
    iconColor: [255, 255, 255, 1],
    avatarColors: [
      [118, 84, 154], [223, 120, 97], [148, 180, 159], [135, 162, 251], [198, 137, 198], [147, 125, 194],
      [50, 82, 136], [133, 180, 224], [193, 163, 163], [225, 160, 89], [66, 97, 101], [107, 119, 178],
      [149, 127, 239], [221, 157, 226], [130, 171, 139], [155, 187, 232], [143, 190, 190], [138, 195, 161],
      [168, 176, 242], [176, 198, 149], [233, 154, 173], [209, 132, 132], [120, 181, 167],
    ],
  },
}
// Same substitutions as normalizeSimpleIconName in the app.
const SIMPLE_ICON_CHAR_MAP = {
  á: 'a', à: 'a', â: 'a', ä: 'a', ã: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n', ř: 'r', š: 's', ż: 'z',
  '.': 'dot', '-': '', '&': 'and', '+': 'plus', ':': '', "'": '', '/': '', '!': '', _: '', '°': '',
}

function env(name) {
  return $.NSProcessInfo.processInfo.environment.objectForKey(name).js || ''
}

function readPipe(pipe) {
  const data = pipe.fileHandleForReading.readDataToEndOfFile
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js
}

function runProcess(path, args) {
  const task = $.NSTask.alloc.init
  const stdout = $.NSPipe.pipe
  const stderr = $.NSPipe.pipe
  task.executableURL = $.NSURL.fileURLWithPath(path)
  task.arguments = args
  task.standardInput = $.NSFileHandle.fileHandleWithNullDevice
  task.standardOutput = stdout
  task.standardError = stderr
  if (!task.launchAndReturnError(null)) throw new Error(`Failed to launch ${path}`)

  // Drain stdout before waiting so a large output cannot fill the pipe and block.
  const out = readPipe(stdout)
  const err = readPipe(stderr)
  task.waitUntilExit
  return { status: task.terminationStatus, out, err }
}

// Runs `ente <args> --json --no-input` and returns parsed stdout.
// Throws with the first stderr line when the CLI fails.
function ente(args) {
  const path = env('ente_path') || DEFAULT_ENTE_PATH
  if (!$.NSFileManager.defaultManager.isExecutableFileAtPath(path)) {
    throw new Error(`ente CLI not found: ${path}`)
  }

  const fullArgs = [...args, '--json', '--no-input']
  const account = env('ente_account')
  if (account) fullArgs.push('--account', account)

  const { status, out, err } = runProcess(path, fullArgs)
  if (status !== 0) {
    const line = err.split('\n').find((l) => l.trim()) || `ente exited with ${status}`
    throw new Error(line.replace(/^Error:\s*/, ''))
  }
  return JSON.parse(out)
}

function fileExists(path) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(path)
}

function readFile(path) {
  return $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js
}

function makeDirectory(path) {
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, $(), null)
  return path
}

// Downloads [{url, path}] in one parallel curl run. Returns the HTTP status per path
// ('000' when the request never completed); failed downloads leave no file behind.
function download(requests) {
  if (requests.length === 0) return {}
  const args = ['--silent', '--fail', '--parallel', '--max-time', String(ICON_DOWNLOAD_TIMEOUT_SECONDS)]
  args.push('--write-out', '%{http_code} %{filename_effective}\\n')
  for (const { url, path } of requests) args.push('--output', path, url)
  const { out } = runProcess(CURL_PATH, args)

  const statuses = {}
  for (const line of out.split('\n')) {
    const match = line.match(/^(\d{3}) (.+)$/)
    if (match) statuses[match[2]] = match[1]
  }
  for (const { path } of requests) {
    if (statuses[path] !== '200') $.NSFileManager.defaultManager.removeItemAtPathError(path, null)
  }
  return statuses
}

function viewCode(id) {
  const code = ente(['auth', 'code', 'view', id, '--offline'])
  return { otp: code.otp, validUntil: Date.parse(code.validUntil) }
}

function secondsLeft(validUntil) {
  return Math.max(0, (validUntil - Date.now()) / 1000)
}

function formatOtp(otp) {
  return /^\d{6}$/.test(otp) ? `${otp.slice(0, 3)} ${otp.slice(3)}` : otp
}

// The CLI does not report the period, so infer it from the time left.
function progressBar(remaining) {
  const period = Math.max(30, Math.ceil(remaining / 30) * 30)
  const filled = Math.round((remaining / period) * BAR_WIDTH)
  return '●'.repeat(filled) + '○'.repeat(BAR_WIDTH - filled)
}

function iconAppearance() {
  const setting = env('icon_appearance')
  if (setting === 'light' || setting === 'dark') return setting
  return $.NSUserDefaults.standardUserDefaults.stringForKey('AppleInterfaceStyle').js === 'Dark' ? 'dark' : 'light'
}

function providerTitle(provider) {
  return provider.replace(/ /g, '').toLowerCase()
}

// Loads (and caches) the custom-icons and simple-icons indexes as maps from
// provider title to {url, hex}, mirroring IconUtils._loadJson in the app.
function loadIconIndex(dir) {
  const paths = { custom: `${dir}/custom-icons.json`, simple: `${dir}/simple-icons.json` }
  download(
    Object.keys(paths)
      .filter((source) => !fileExists(paths[source]))
      .map((source) => ({ url: `${ICON_SOURCES[source]}/${ICON_INDEX_PATHS[source]}`, path: paths[source] })),
  )
  if (!fileExists(paths.custom) || !fileExists(paths.simple)) return null

  const custom = {}
  for (const icon of JSON.parse(readFile(paths.custom)).icons) {
    const titleKey = providerTitle(icon.title)
    custom[titleKey] = { source: 'custom', file: icon.slug || titleKey, hex: icon.hex }
    for (const name of icon.altNames || []) {
      custom[providerTitle(name)] = { source: 'custom', file: icon.slug || titleKey, hex: icon.hex }
    }
  }
  const simple = {}
  for (const icon of JSON.parse(readFile(paths.simple))) {
    const titleKey = providerTitle(icon.title)
    const file = icon.slug || [...titleKey].map((c) => SIMPLE_ICON_CHAR_MAP[c] ?? c).join('').trim()
    simple[titleKey] = { source: 'simple', file, hex: icon.hex }
  }
  return { custom, simple }
}

// Same lookup order as IconUtils.getIcon: the whole title, then the part before
// '(' or '.'; custom icons win over simple-icons for each candidate.
function resolveIcon(index, issuer) {
  const title = providerTitle(issuer)
  const candidates = [title, ...['(', '.'].filter((c) => title.includes(c)).map((c) => title.split(c)[0])]
  for (const candidate of candidates) {
    const icon = index.custom[candidate] || index.simple[candidate]
    if (icon) return icon
  }
  return null
}

function relativeLuminance([r, g, b]) {
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255)
}

// IconUtils._getAdaptiveColor: neutral greys lacking contrast use the theme icon color.
function adaptiveColor(hex, appearance) {
  if (!hex) return null
  const n = parseInt(hex, 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const [r, g, b] = rgb
  const neutralGrey = Math.abs(r - g) <= 3 && Math.abs(g - b) <= 3 && Math.abs(b - r) <= 3
  const luminance = relativeLuminance(rgb)
  if (neutralGrey && ((appearance === 'light' && luminance > 0.7) || (appearance === 'dark' && luminance < 0.05))) {
    return THEME[appearance].iconColor
  }
  return [...rgb, 1]
}

function nsColor([r, g, b, a = 1]) {
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(r / 255, g / 255, b / 255, a)
}

function writePng(path, draw) {
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, ICON_SIZE, ICON_SIZE, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0,
  )
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
  draw($.NSMakeRect(0, 0, ICON_SIZE, ICON_SIZE))
  $.NSGraphicsContext.restoreGraphicsState
  return rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(path, true)
}

// CoreSVG rejects minified arcs whose flags are run together with the next
// number (e.g. `a1 1 0 001 1`), so rewrite path data with explicit separators.
function expandArcFlags(pathData) {
  const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
  let i = 0
  const skip = () => {
    while (i < pathData.length && /[\s,]/.test(pathData[i])) i++
  }
  const read = (pattern) => {
    skip()
    pattern.lastIndex = i
    const match = pattern.exec(pathData)
    if (!match) throw new Error(`Bad path data at ${i}`)
    i = pattern.lastIndex
    return match[0]
  }
  const flag = /[01]/y
  const out = []
  let command = ''
  for (skip(); i < pathData.length; skip()) {
    if (/[a-zA-Z]/.test(pathData[i])) {
      command = pathData[i++]
      out.push(command)
    } else if (command === 'a' || command === 'A') {
      out.push([read(number), read(number), read(number), read(flag), read(flag), read(number), read(number)].join(' '))
    } else {
      out.push(read(number))
    }
  }
  return out.join(' ')
}

function loadSvg(svgPath) {
  const svg = readFile(svgPath) || ''
  let normalized = svg
  try {
    normalized = svg.replace(/(\sd=")([^"]*)"/g, (_, prefix, pathData) => {
      const whitespaceEntities = /&#(?:9|10|13|32|x9|xa|xd|x20);/gi
      return `${prefix}${expandArcFlags(pathData.replace(whitespaceEntities, ' '))}"`
    })
  } catch (_) {
    // Leave unparseable path data for CoreSVG to handle as best it can.
  }
  return $.NSImage.alloc.initWithData($(normalized).dataUsingEncoding($.NSUTF8StringEncoding))
}

// Draws the SVG aspect-fit, tinted with the brand color like the app's srcIn filter.
function renderSvgIcon(svgPath, pngPath, color) {
  const image = loadSvg(svgPath)
  if (image.isNil() || !(image.size.width > 0 && image.size.height > 0)) return false
  return writePng(pngPath, (rect) => {
    const scale = Math.min(ICON_SIZE / image.size.width, ICON_SIZE / image.size.height)
    const width = image.size.width * scale
    const height = image.size.height * scale
    const target = $.NSMakeRect((ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height)
    image.drawInRectFromRectOperationFraction(target, $.NSZeroRect, $.NSCompositingOperationSourceOver, 1)
    if (color) {
      nsColor(color).set
      $.NSRectFillUsingOperation(rect, $.NSCompositingOperationSourceIn)
    }
  })
}

// IconUtils._fallbackAvatar: the first letter on a colored circle. The app picks the
// color with Dart's String.hashCode, which cannot be reproduced here, so a stable
// string hash is used instead.
function renderAvatar(pngPath, title, appearance) {
  const colors = THEME[appearance].avatarColors
  let hash = 0
  for (const c of title) hash = (hash * 31 + c.codePointAt(0)) | 0
  const letter = [...title.toUpperCase()][0]
  return writePng(pngPath, (rect) => {
    nsColor(colors[Math.abs(hash) % colors.length]).set
    $.NSBezierPath.bezierPathWithOvalInRect(rect).fill
    const attributes = $.NSDictionary.dictionaryWithObjectsForKeys(
      $([$.NSFont.boldSystemFontOfSize(ICON_SIZE * 0.6), $.NSColor.whiteColor]),
      $([$.NSFontAttributeName, $.NSForegroundColorAttributeName]),
    )
    const text = $.NSString.alloc.initWithString(letter)
    const size = text.sizeWithAttributes(attributes)
    text.drawAtPointWithAttributes($.NSMakePoint((ICON_SIZE - size.width) / 2, (ICON_SIZE - size.height) / 2), attributes)
  })
}

function avatarIcon(dir, title, appearance) {
  const path = `${dir}/avatar-${appearance}-${encodeURIComponent(title)}.png`
  if (fileExists(path) || renderAvatar(path, title, appearance)) return path
  return null
}

// Returns {issuer: png path} for every issuer, downloading and rendering only
// icons missing from the cache. Icon failures never break the list.
function issuerIcons(issuers) {
  const appearance = iconAppearance()
  const root = env('alfred_workflow_cache') || `${$.NSTemporaryDirectory().js}ente-auth-workflow`
  const dir = makeDirectory(`${root}/icons/${ENTE_COMMIT.slice(0, 7)}-${SIMPLE_ICONS_COMMIT.slice(0, 7)}`)
  const svgDir = makeDirectory(`${dir}/svg`)
  const pngDir = makeDirectory(`${dir}/png`)
  const index = loadIconIndex(dir)

  const icons = {}
  const pending = {}
  for (const issuer of new Set(issuers)) {
    const title = providerTitle(issuer)
    if (!title) continue
    const icon = index && resolveIcon(index, issuer)
    if (!icon) {
      icons[issuer] = avatarIcon(pngDir, title, appearance)
      continue
    }
    const png = `${pngDir}/${icon.source}-${encodeURIComponent(icon.file)}-${appearance}.png`
    if (fileExists(png)) {
      icons[issuer] = png
      continue
    }
    const svg = `${svgDir}/${icon.source}-${encodeURIComponent(icon.file)}.svg`
    const url = `${ICON_SOURCES[icon.source]}/icons/${encodeURIComponent(icon.file)}.svg`
    pending[issuer] = { title, icon, svg, png, url }
  }

  const missing = Object.values(pending).filter((p) => !fileExists(p.svg))
  const statuses = download([...new Map(missing.map((p) => [p.svg, { url: p.url, path: p.svg }])).values()])
  for (const [issuer, { title, icon, svg, png }] of Object.entries(pending)) {
    if (fileExists(svg) && renderSvgIcon(svg, png, adaptiveColor(icon.hex, appearance))) {
      icons[issuer] = png
    } else if (statuses[svg] && statuses[svg] !== '000') {
      // The icon is missing upstream (e.g. 404), so the avatar stands in permanently.
      icons[issuer] = renderAvatar(png, title, appearance) ? png : null
    } else {
      // Network failure: show the avatar now and retry the download next time.
      icons[issuer] = avatarIcon(pngDir, title, appearance)
    }
  }
  return icons
}

function codeVariables(code, action, icon) {
  return { code_id: code.id, code_name: code.name, code_icon: icon || '', action }
}

function listItem(code, icon) {
  const title = code.issuer || code.name
  const item = {
    uid: code.id,
    title,
    subtitle: code.accountName,
    arg: code.id,
    match: [code.issuer, code.accountName, code.name].join(' '),
    autocomplete: title,
    variables: codeVariables(code, 'copy', icon),
    mods: {
      cmd: { arg: code.id, subtitle: 'Paste to frontmost app', variables: codeVariables(code, 'paste', icon) },
      alt: { arg: code.name, subtitle: 'Show live code', variables: codeVariables(code, 'live', icon) },
    },
  }
  if (icon) item.icon = { path: icon }
  if (code.type === 'hotp') {
    item.valid = false
    item.subtitle = `${code.accountName} · HOTP is not supported by the ente CLI yet`
  }
  return item
}

function list() {
  let codes
  try {
    // Online refresh also syncs the local data that `view --offline` reads.
    codes = ente(['auth', 'code', 'list', '--all'])
  } catch (onlineError) {
    try {
      codes = ente(['auth', 'code', 'list', '--all', '--offline'])
    } catch (_) {
      throw onlineError
    }
  }

  if (codes.length === 0) {
    return { items: [{ title: 'No saved codes', subtitle: 'Add codes in the Ente Auth app', valid: false }] }
  }
  let icons = {}
  try {
    icons = issuerIcons(codes.map((c) => c.issuer))
  } catch (_) {
    // Icons are cosmetic; fall back to the workflow icon.
  }
  return {
    cache: { seconds: LIST_CACHE_SECONDS, loosereload: true },
    items: codes.map((c) => listItem(c, icons[c.issuer])),
  }
}

function code(id) {
  let current = viewCode(id)
  const remaining = secondsLeft(current.validUntil)
  if (remaining < MIN_REMAINING_SECONDS) {
    delay(remaining + 0.2)
    current = viewCode(id)
  }
  return {
    alfredworkflow: {
      arg: current.otp,
      variables: { remaining: String(Math.floor(secondsLeft(current.validUntil))) },
    },
  }
}

// Reruns every second; the OTP is carried in variables so ente is only
// called again once the current code expires.
function live() {
  const id = env('code_id')
  let otp = env('live_otp')
  let validUntil = Date.parse(env('live_until'))
  if (!otp || !(secondsLeft(validUntil) > 0)) {
    ;({ otp, validUntil } = viewCode(id))
  }

  const remaining = Math.ceil(secondsLeft(validUntil))
  const icon = env('code_icon')
  const variables = { code_id: id, code_name: env('code_name'), code_icon: icon }
  return {
    rerun: 1,
    variables: { ...variables, live_otp: otp, live_until: new Date(validUntil).toISOString() },
    items: [
      {
        ...(icon && { icon: { path: icon } }),
        title: formatOtp(otp),
        subtitle: `${env('code_name')} · ${progressBar(remaining)} ${remaining}s`,
        arg: id,
        variables: { ...variables, action: 'copy' },
        mods: {
          cmd: { arg: id, subtitle: 'Paste to frontmost app', variables: { ...variables, action: 'paste' } },
        },
        text: { copy: otp, largetype: otp },
      },
    ],
  }
}

function errorOutput(command, message) {
  if (command === 'code') {
    return { alfredworkflow: { arg: message, variables: { action: 'error' } } }
  }
  return { items: [{ title: 'Ente Auth error', subtitle: message, valid: false, icon: { path: ERROR_ICON } }] }
}

function run(argv) {
  const [command, arg] = argv
  try {
    switch (command) {
      case 'list':
        return JSON.stringify(list())
      case 'code':
        return JSON.stringify(code(arg))
      case 'live':
        return JSON.stringify(live())
      default:
        throw new Error(`Unknown command: ${command}`)
    }
  } catch (e) {
    return JSON.stringify(errorOutput(command, e.message))
  }
}
