#!/usr/bin/osascript -l JavaScript
// Alfred workflow entry point for Ente Auth.
//   ente-auth.js list       Script Filter: every saved code (Alfred filters)
//   ente-auth.js code <id>  Run Script: current OTP as an alfredworkflow object
//   ente-auth.js live       Script Filter: auto-refreshing OTP with countdown
ObjC.import('Foundation')

const DEFAULT_ENTE_PATH = '/opt/homebrew/bin/ente'
const LIST_CACHE_SECONDS = 300
// Codes closer than this to expiry are skipped in favour of the next one.
const MIN_REMAINING_SECONDS = 3
const BAR_WIDTH = 10

function env(name) {
  return $.NSProcessInfo.processInfo.environment.objectForKey(name).js || ''
}

function readPipe(pipe) {
  const data = pipe.fileHandleForReading.readDataToEndOfFile
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js
}

// Runs `ente <args> --json --no-input` and returns parsed stdout.
// Throws with the first stderr line when the CLI fails.
function ente(args) {
  const path = env('ente_path') || DEFAULT_ENTE_PATH
  if (!$.NSFileManager.defaultManager.isExecutableFileAtPath(path)) {
    throw new Error(`ente CLI를 찾을 수 없습니다: ${path}`)
  }

  const fullArgs = [...args, '--json', '--no-input']
  const account = env('ente_account')
  if (account) fullArgs.push('--account', account)

  const task = $.NSTask.alloc.init
  const stdout = $.NSPipe.pipe
  const stderr = $.NSPipe.pipe
  task.executableURL = $.NSURL.fileURLWithPath(path)
  task.arguments = fullArgs
  task.standardInput = $.NSFileHandle.fileHandleWithNullDevice
  task.standardOutput = stdout
  task.standardError = stderr
  if (!task.launchAndReturnError(null)) throw new Error(`ente 실행 실패: ${path}`)

  // Drain stdout before waiting so a large list cannot fill the pipe and block.
  const out = readPipe(stdout)
  const err = readPipe(stderr)
  task.waitUntilExit

  if (task.terminationStatus !== 0) {
    const line = err.split('\n').find((l) => l.trim()) || `ente exited with ${task.terminationStatus}`
    throw new Error(line.replace(/^Error:\s*/, ''))
  }
  return JSON.parse(out)
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
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

function codeVariables(code, action) {
  return { code_id: code.id, code_name: code.name, action }
}

function listItem(code) {
  const title = code.issuer || code.name
  const item = {
    uid: code.id,
    title,
    subtitle: code.accountName,
    arg: code.id,
    match: [code.issuer, code.accountName, code.name].join(' '),
    autocomplete: title,
    variables: codeVariables(code, 'copy'),
    mods: {
      cmd: { arg: code.id, subtitle: '맨 앞 앱에 붙여넣기', variables: codeVariables(code, 'paste') },
      alt: { arg: code.name, subtitle: '실시간 코드 보기', variables: codeVariables(code, 'live') },
    },
  }
  if (code.type === 'hotp') {
    item.valid = false
    item.subtitle = `${code.accountName} · HOTP는 ente CLI가 아직 지원하지 않습니다`
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
    return { items: [{ title: '저장된 코드가 없습니다', subtitle: 'Ente Auth 앱에서 코드를 추가하세요', valid: false }] }
  }
  return {
    cache: { seconds: LIST_CACHE_SECONDS, loosereload: true },
    items: codes.map(listItem),
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
  const variables = { code_id: id, code_name: env('code_name') }
  return {
    rerun: 1,
    variables: { ...variables, live_otp: otp, live_until: new Date(validUntil).toISOString() },
    items: [
      {
        title: formatOtp(otp),
        subtitle: `${env('code_name')} · ${progressBar(remaining)} ${remaining}s`,
        arg: id,
        variables: { ...variables, action: 'copy' },
        mods: {
          cmd: { arg: id, subtitle: '맨 앞 앱에 붙여넣기', variables: { ...variables, action: 'paste' } },
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
  return { items: [{ title: 'Ente Auth 오류', subtitle: message, valid: false }] }
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
        throw new Error(`알 수 없는 명령: ${command}`)
    }
  } catch (e) {
    return JSON.stringify(errorOutput(command, e.message))
  }
}
