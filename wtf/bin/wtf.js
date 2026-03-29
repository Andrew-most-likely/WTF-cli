#!/usr/bin/env node
'use strict'

const si = require('systeminformation')
const os = require('os')

// ── Color ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const IS_TTY = process.stdout.isTTY === true
const NO_COLOR = argv.includes('--no-color') || argv.includes('-j') || argv.includes('--json') || !IS_TTY

const c = NO_COLOR ? new Proxy({}, { get: () => '' }) : {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
}

// ── Args ─────────────────────────────────────────────────────────────────────
function hasFlag(...flags) { return flags.some(f => argv.includes(f)) }

function flagVal(short, long) {
  for (const f of [short, long]) {
    const i = argv.indexOf(f)
    if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1]
  }
  return null
}

const ARGS = {
  verbose:  hasFlag('-v', '--verbose'),
  json:     hasFlag('-j', '--json'),
  watch:    hasFlag('-w', '--watch') ? (parseInt(flagVal('-w', '--watch')) || 2) : false,
  top:      parseInt(flagVal('-t', '--top')) || (hasFlag('-v', '--verbose') ? 10 : 5),
  sections: (() => {
    const s = []
    if (hasFlag('--cpu'))  s.push('cpu')
    if (hasFlag('--mem'))  s.push('mem')
    if (hasFlag('--disk')) s.push('disk')
    if (hasFlag('--net'))  s.push('net')
    return s.length ? s : ['cpu', 'mem', 'disk', 'net']
  })(),
  version:  hasFlag('--version'),
  help:     hasFlag('-h', '--help'),
}

// ── Help ─────────────────────────────────────────────────────────────────────
if (ARGS.help) {
  process.stdout.write(`
${c.bold}wtf${c.reset} — why is my computer slow right now?

${c.bold}USAGE${c.reset}
  wtf [flags]

${c.bold}FLAGS${c.reset}
  -v, --verbose        More processes, extra detail
  -j, --json           JSON output (pipe-friendly, no color)
      --no-color       Strip ANSI colors (e.g. for plain-text logs)
      --cpu            CPU section only
      --mem            Memory section only
      --disk           Disk section only
      --net            Network section only
  -t, --top <n>        Top N processes per section  (default: 5)
  -w, --watch [secs]   Live refresh, default every 2s
      --version        Print version
  -h, --help           Show this help

${c.bold}EXAMPLES${c.reset}
  wtf                       Full diagnosis
  wtf --cpu --mem           CPU and memory only
  wtf -v                    Verbose: top 10, extra stats
  wtf -j | jq '.cpu'        JSON piped to jq
  wtf -w 5                  Refresh every 5 seconds
  wtf --no-color > out.txt  Plain text to file

`)
  process.exit(0)
}

if (ARGS.version) {
  process.stdout.write(require('../package.json').version + '\n')
  process.exit(0)
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function bar(pct, width = 10) {
  const filled = Math.round(Math.min(pct, 100) / 100 * width)
  const color = pct >= 90 ? c.red : pct >= 70 ? c.yellow : c.green
  return color + '█'.repeat(filled) + c.dim + '░'.repeat(width - filled) + c.reset
}

function pctColor(pct) {
  return pct >= 90 ? c.red : pct >= 70 ? c.yellow : c.green
}

function fmtBytes(bytes) {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB'
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + ' GB'
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB'
  if (bytes >= 1e3)  return (bytes / 1e3).toFixed(1)  + ' KB'
  return bytes + ' B'
}

function fmtSpeed(bps) { return fmtBytes(Math.max(0, bps || 0)) + '/s' }

// strip ANSI for length calculations
function plain(str) { return str.replace(/\x1b\[[0-9;]*m/g, '') }
function padEnd(str, len) { return str + ' '.repeat(Math.max(0, len - plain(str).length)) }
function padStart(str, len) { return ' '.repeat(Math.max(0, len - plain(str).length)) + str }

const HR = c.dim + '─'.repeat(52) + c.reset

// ── Collect ──────────────────────────────────────────────────────────────────
async function collect() {
  const need = (s) => ARGS.sections.includes(s)
  const needProcs = need('cpu') || need('mem')

  const [cpuLoad, procs, mem, disk, net] = await Promise.all([
    need('cpu')   ? si.currentLoad()   : null,
    needProcs     ? si.processes()     : null,
    need('mem')   ? si.mem()           : null,
    need('disk')  ? si.fsSize()        : null,
    need('net')   ? si.networkStats()  : null,
  ])

  return { cpuLoad, procs, mem, disk, net }
}

// ── Sections ─────────────────────────────────────────────────────────────────
function renderCPU(cpuLoad, procs) {
  const pct = Math.round(cpuLoad.currentLoad)
  const header = `${c.bold}${c.cyan} CPU${c.reset}  ${bar(pct)}  ${pctColor(pct)}${pct}%${c.reset}`
  const lines = [
    ARGS.verbose
      ? header + `  ${c.gray}${os.cpus().length} cores  load avg ${os.loadavg().map(n => n.toFixed(2)).join(' ')}${c.reset}`
      : header
  ]

  procs.list
    .filter(p => p.cpu > 0)
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, ARGS.top)
    .forEach(p => {
      const name   = padEnd(c.white + p.name + c.reset, 32)
      const pctStr = padStart(pctColor(p.cpu) + p.cpu.toFixed(1) + '%' + c.reset, 9)
      const extra  = ARGS.verbose ? `  ${c.gray}pid ${p.pid}  mem ${fmtBytes(p.memRss)}${c.reset}` : ''
      lines.push(`   ${name} ${pctStr}${extra}`)
    })

  return lines
}

function renderMem(mem, procs) {
  const pct  = Math.round(mem.used / mem.total * 100)
  const info = `${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}`
  const header = `${c.bold}${c.cyan} MEM${c.reset}  ${bar(pct)}  ${pctColor(pct)}${pct}%${c.reset}  ${c.gray}${info}${c.reset}`
  const lines = [header]

  if (ARGS.verbose) {
    lines.push(`   ${c.gray}free ${fmtBytes(mem.free)}  available ${fmtBytes(mem.available)}  swap ${fmtBytes(mem.swapused)} / ${fmtBytes(mem.swaptotal)}${c.reset}`)
  }

  procs.list
    .filter(p => p.memRss > 0)
    .sort((a, b) => b.memRss - a.memRss)
    .slice(0, ARGS.top)
    .forEach(p => {
      const name   = padEnd(c.white + p.name + c.reset, 32)
      const memStr = padStart(c.yellow + fmtBytes(p.memRss) + c.reset, 10)
      const extra  = ARGS.verbose ? `  ${c.gray}pid ${p.pid}${c.reset}` : ''
      lines.push(`   ${name} ${memStr}${extra}`)
    })

  return lines
}

function renderDisk(disk) {
  const lines = [`${c.bold}${c.cyan} DSK${c.reset}`]

  disk
    .filter(d => d.size > 0)
    .forEach(d => {
      const pct    = Math.round(d.use)
      const label  = padEnd(c.white + d.fs + c.reset, 20)
      const usage  = `${fmtBytes(d.used)} / ${fmtBytes(d.size)}`
      const mount  = ARGS.verbose ? `  ${c.gray}${d.mount}${c.reset}` : ''
      lines.push(`   ${label}  ${bar(pct)}  ${pctColor(pct)}${pct}%${c.reset}  ${c.gray}${usage}${c.reset}${mount}`)
    })

  return lines
}

function renderNet(nets) {
  const lines = [`${c.bold}${c.cyan} NET${c.reset}`]

  const active = nets.filter(n => n.rx_sec !== null)
  if (!active.length) {
    lines.push(`   ${c.gray}no active interfaces${c.reset}`)
    return lines
  }

  active.forEach(n => {
    const iface  = padEnd(c.white + n.iface + c.reset, 14)
    const rx     = `${c.green}↓ ${padStart(fmtSpeed(n.rx_sec), 12)}${c.reset}`
    const tx     = `${c.yellow}↑ ${padStart(fmtSpeed(n.tx_sec), 12)}${c.reset}`
    const totals = ARGS.verbose
      ? `  ${c.gray}total ↓ ${fmtBytes(n.rx_bytes)}  ↑ ${fmtBytes(n.tx_bytes)}${c.reset}`
      : ''
    lines.push(`   ${iface}  ${rx}  ${tx}${totals}`)
  })

  return lines
}

// ── Diagnose ─────────────────────────────────────────────────────────────────
function diagnose({ cpuLoad, procs, mem, disk, net }) {
  const notes = []

  if (cpuLoad && cpuLoad.currentLoad > 80) {
    const top = procs?.list.slice().sort((a, b) => b.cpu - a.cpu)[0]
    if (top) notes.push(`${c.red}High CPU:${c.reset} ${top.name} is using ${top.cpu.toFixed(0)}% CPU`)
  }

  if (mem) {
    const pct = mem.used / mem.total * 100
    if (pct > 90) {
      const top = procs?.list.slice().sort((a, b) => b.memRss - a.memRss)[0]
      notes.push(`${c.red}Critical RAM:${c.reset} ${Math.round(pct)}% used${top ? ` — ${top.name} holding ${fmtBytes(top.memRss)}` : ''}`)
    } else if (pct > 75) {
      notes.push(`${c.yellow}High RAM:${c.reset} ${Math.round(pct)}% used (${fmtBytes(mem.used)} / ${fmtBytes(mem.total)})`)
    }
  }

  if (disk) {
    disk.filter(d => d.size > 0 && d.use >= 90).forEach(d =>
      notes.push(`${c.red}Disk critical:${c.reset} ${d.fs} is ${Math.round(d.use)}% full — only ${fmtBytes(d.size - d.used)} free`))
    disk.filter(d => d.size > 0 && d.use >= 80 && d.use < 90).forEach(d =>
      notes.push(`${c.yellow}Disk warning:${c.reset} ${d.fs} is ${Math.round(d.use)}% full`))
  }

  if (net) {
    const rx = net.reduce((s, n) => s + (n.rx_sec || 0), 0)
    const tx = net.reduce((s, n) => s + (n.tx_sec || 0), 0)
    if (rx > 5e6) notes.push(`${c.yellow}Heavy download:${c.reset} ${fmtSpeed(rx)}`)
    if (tx > 2e6) notes.push(`${c.yellow}Heavy upload:${c.reset} ${fmtSpeed(tx)}`)
  }

  return notes
}

// ── JSON output ───────────────────────────────────────────────────────────────
function toJSON(data) {
  const { cpuLoad, procs, mem, disk, net } = data
  const out = {}

  if (cpuLoad) out.cpu = {
    pct:  Math.round(cpuLoad.currentLoad),
    cores: os.cpus().length,
    top:  procs?.list.slice().sort((a,b)=>b.cpu-a.cpu).slice(0, ARGS.top)
            .map(p => ({ name: p.name, cpu: p.cpu, pid: p.pid, mem_rss: p.memRss }))
  }

  if (mem) out.mem = {
    pct:       Math.round(mem.used / mem.total * 100),
    used:      mem.used,
    total:     mem.total,
    free:      mem.free,
    available: mem.available,
    top:       procs?.list.slice().sort((a,b)=>b.memRss-a.memRss).slice(0, ARGS.top)
                 .map(p => ({ name: p.name, mem_rss: p.memRss, pid: p.pid }))
  }

  if (disk) out.disk = disk.filter(d => d.size > 0)
    .map(d => ({ fs: d.fs, mount: d.mount, pct: Math.round(d.use), used: d.used, size: d.size, free: d.size - d.used }))

  if (net) out.net = net.filter(n => n.rx_sec !== null)
    .map(n => ({ iface: n.iface, rx_sec: n.rx_sec, tx_sec: n.tx_sec, rx_bytes: n.rx_bytes, tx_bytes: n.tx_bytes }))

  out.diagnosis = diagnose(data).map(s => plain(s))

  return JSON.stringify(out, null, 2)
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function run() {
  const data = await collect()

  if (ARGS.json) {
    process.stdout.write(toJSON(data) + '\n')
    return
  }

  const parts = []
  if (ARGS.sections.includes('cpu')  && data.cpuLoad) parts.push(renderCPU(data.cpuLoad, data.procs))
  if (ARGS.sections.includes('mem')  && data.mem)     parts.push(renderMem(data.mem, data.procs))
  if (ARGS.sections.includes('disk') && data.disk)    parts.push(renderDisk(data.disk))
  if (ARGS.sections.includes('net')  && data.net)     parts.push(renderNet(data.net))

  const body  = parts.map(s => s.join('\n')).join('\n\n')
  const notes = diagnose(data)
  const tail  = notes.length ? '\n' + HR + '\n' + notes.map(n => ` ${n}`).join('\n') + '\n' : ''

  process.stdout.write('\n' + body + tail + '\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (ARGS.watch) {
    const secs = ARGS.watch
    while (true) {
      if (IS_TTY) process.stdout.write('\x1b[2J\x1b[H')
      const ts = new Date().toLocaleTimeString()
      process.stdout.write(`${c.gray}wtf  ·  ${ts}  ·  refreshing every ${secs}s  (ctrl+c to quit)${c.reset}\n`)
      await run()
      await new Promise(r => setTimeout(r, secs * 1000))
    }
  } else {
    await run()
  }
}

main().catch(err => {
  process.stderr.write(c.red + 'error: ' + c.reset + err.message + '\n')
  process.exit(1)
})
