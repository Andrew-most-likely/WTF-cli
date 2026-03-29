# wtf

**Why is my computer slow right now?**

One command that tells you exactly what's eating your CPU, memory, disk, and network — in plain English. Not `top`. Not 10 tools. One answer.

```
$ wtf

 CPU  ████████░░  82%
   Chrome                          42.3%
   node                             8.1%
   Slack                            3.4%

 MEM  ███████░░░  71%  11.4 GB / 16.0 GB
   Chrome                        4.2 GB
   node                          1.1 GB
   Slack                         800 MB

 DSK
   /dev/sda1             ██████░░░░  58%  230 GB / 400 GB

 NET
   eth0          ↓      1.2 MB/s  ↑    200 KB/s

────────────────────────────────────────────────────────
 High CPU: Chrome is using 42% CPU
```

## Install

```sh
npm install -g wtf-cli
```

## Usage

```sh
wtf                       # full diagnosis
wtf --cpu --mem           # CPU and memory only
wtf -v                    # verbose: top 10 processes, extra stats
wtf -j | jq '.cpu'        # JSON output piped to jq
wtf -w 5                  # live refresh every 5 seconds
wtf --no-color > out.txt  # plain text to file
```

## Flags

| Flag | Description |
|------|-------------|
| `-v, --verbose` | More processes, extra detail |
| `-j, --json` | JSON output (pipe-friendly, no color) |
| `--no-color` | Strip ANSI colors |
| `--cpu` | CPU section only |
| `--mem` | Memory section only |
| `--disk` | Disk section only |
| `--net` | Network section only |
| `-t, --top <n>` | Top N processes per section (default: 5) |
| `-w, --watch [secs]` | Live refresh, default every 2s |
| `--version` | Print version |
| `-h, --help` | Show help |

## License

MIT
