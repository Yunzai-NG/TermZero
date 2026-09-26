/**
 * 模块职责：`rc` / `rcp` 的核心 —— 起一个子进程跑 Shell 命令，收集 stdout / stderr / 错误
 * 依赖方向：`node:child_process`、`node:os`、`node:process`
 * 生命周期：无状态
 * 注意事项：**用 `node:child_process` 起子进程。** 本框架零全局，不挂任何全局执行器，故直接用标准库：
 *          一次给出完整命令串、经系统 shell 执行、回收 stdout/stderr/退出码。
 *
 *          **平台决定 shell。** Windows 上走 PowerShell（`cmd.exe` 对 UTF-8 与管道支持差），
 *          其余系统走 `$SHELL` 或 `/bin/sh`。这一步不做命令注入防护 —— 这条命令本就是主人要机器人「原样
 *          执行」的任意 Shell，防护无从谈起；门禁在 `.master()`。
 *
 *          **超时到了要杀整棵进程树。** 一条 `while true` 或卡在网络里的命令，光杀父进程会留下孤儿子进程。
 *          `exec` 的 `timeout` + `killSignal` 只发给直接子进程；但配合默认的 shell 包裹，绝大多数情况够用，
 *          且再深的进程树管理会把这个小工具复杂度顶上天 —— 留给使用者用命令本身去收尾。
 */

import { exec } from "node:child_process"
import { hostname, userInfo } from "node:os"
import process from "node:process"

/** 一次 Shell 执行的结果 */
export interface ShellResult {
  /** 标准输出 */
  stdout: string
  /** 标准错误 */
  stderr: string
  /** 执行错误（命令不存在、超时、非零退出等）；正常结束时 undefined */
  error?: Error
}

/** 执行参数 */
export interface ShellOptions {
  /** 超时毫秒 */
  timeoutMs: number
  /** 输出解码 */
  encoding: "utf8" | "latin1"
}

/**
 * 选择本平台的 shell 可执行文件
 * @returns shell 路径；交给 `exec` 的 `shell` 选项
 */
function pickShell(): string {
  if (process.platform === "win32") return "powershell.exe"
  return process.env["SHELL"] ?? "/bin/sh"
}

/**
 * 按平台与解码方式调整命令串
 *
 * Windows PowerShell 的控制台输出默认走系统代码页（简体中文机器上是 GBK/cp936），我们却按 utf8 解码它的
 * stdout，中文于是变成乱码（`目录:` → `Ⅼ㎄:`）。这里在命令最前面塞一句 `[Console]::OutputEncoding = UTF8`，
 * 让 PowerShell 改用 UTF-8 编码写 stdout，两端就对上了。只在「win32 且按 utf8 解码」时加 —— 使用者显式选了
 * `latin1` 说明他要的就是原始字节，不该被我们悄悄改掉；非 Windows 的 shell 也无此问题。
 * @param command 原始命令串
 * @param encoding 解码方式
 * @returns 实际交给 shell 执行的命令串
 */
function prepareCommand(command: string, encoding: ShellOptions["encoding"]): string {
  if (process.platform === "win32" && encoding === "utf8") {
    return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
  }
  return command
}

/**
 * 执行一条 Shell 命令
 * @param command 命令串
 * @param opts 执行参数
 * @returns 执行结果
 */
export function runShell(command: string, opts: ShellOptions): Promise<ShellResult> {
  return new Promise(resolve => {
    exec(
      prepareCommand(command, opts.encoding),
      {
        shell: pickShell(),
        timeout: opts.timeoutMs,
        // 10 MB：够大以免正常输出被 maxBuffer 截断报错，又不至于让一条失控命令吃满内存
        maxBuffer: 10 * 1024 * 1024,
        encoding: opts.encoding,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          ...(error ? { error } : {})
        })
      }
    )
  })
}

/**
 * 拼一行仿真的 Shell 提示符，供出图版放在命令上方
 *
 * 形如 `user@host cwd $`。与其多起一个子进程去问真实 shell 拿 `$PS1`，此处用
 * `os.userInfo()` / `os.hostname()` / `process.cwd()` 拼一个足够像的，省掉那次进程开销 ——
 * 图上要的只是「这条命令在哪台机器、哪个目录下跑的」这点上下文。
 * @param command 用户输入的命令
 * @returns 提示符行文本
 */
export function promptLine(command: string): string {
  let user = "user"
  try {
    user = userInfo().username
  } catch {
    // 某些沙箱里 userInfo 会抛（无 uid 映射），退回占位名
  }
  const sign = process.platform === "win32" ? ">" : "$"
  return `${user}@${hostname()} ${process.cwd()} ${sign} ${command}`
}
