/**
 * 模块职责：把带 ANSI 转义序列（SGR 颜色/样式）的文本转成安全的 HTML 片段
 * 依赖方向：无外部依赖，纯字符串处理
 * 生命周期：无状态，纯函数
 * 注意事项：**为什么自己写而不装 `ansi_up`。** 常见做法是用 `ansi_up` 把 `node:util` 带色 inspect
 *          与 Shell 输出里的颜色转成 HTML。本插件刻意零第三方依赖：能离线构建、不改动工作区 lockfile，
 *          也不必为「一段染色」引入一个包。代价是只覆盖常见 SGR 子集 —— 前景/背景 16 色、256 色与
 *          真彩、加粗/暗淡/斜体/下划线/反显。这些足以还原 `util.inspect` 与绝大多数 CLI 的着色。
 *
 *          **先转义再着色，顺序不能反。** 文本可能来自用户命令的输出，里面完全可能有 `<script>`。
 *          若先按颜色切段再逐段包 `<span>`，那些 `<` 就原样进了 HTML。故所有可见文本一律先
 *          `escapeHtml`，`<span>` 标签是本模块自己拼的、可信，不受影响。
 *
 *          **未识别的转义序列直接丢弃，而非原样保留。** 光标移动、清屏这类非 SGR 序列在静态图里没有
 *          意义，保留下来只会是一串 `[2J` 之类的噪声。
 */

/** SGR 参数到 CSS 前景色的映射（标准 8 色 + 明亮 8 色） */
const FG: Record<number, string> = {
  30: "#000000", 31: "#cd3131", 32: "#0dbc79", 33: "#e5e510",
  34: "#2472c8", 35: "#bc3fbc", 36: "#11a8cd", 37: "#e5e5e5",
  90: "#666666", 91: "#f14c4c", 92: "#23d18b", 93: "#f5f543",
  94: "#3b8eea", 95: "#d670d6", 96: "#29b8db", 97: "#ffffff"
}

/** SGR 参数到 CSS 背景色的映射 */
const BG: Record<number, string> = {
  40: "#000000", 41: "#cd3131", 42: "#0dbc79", 43: "#e5e510",
  44: "#2472c8", 45: "#bc3fbc", 46: "#11a8cd", 47: "#e5e5e5",
  100: "#666666", 101: "#f14c4c", 102: "#23d18b", 103: "#f5f543",
  104: "#3b8eea", 105: "#d670d6", 106: "#29b8db", 107: "#ffffff"
}

/** 256 色调色板的前 16 项，与上面的 16 色一致，其余按 xterm 立方体/灰阶推算 */
const CUBE = [0, 95, 135, 175, 215, 255]

/** 当前染色状态 */
interface SgrState {
  /** 前景色 CSS 值 */
  fg?: string
  /** 背景色 CSS 值 */
  bg?: string
  /** 加粗 */
  bold?: boolean
  /** 暗淡 */
  dim?: boolean
  /** 斜体 */
  italic?: boolean
  /** 下划线 */
  underline?: boolean
  /** 反显（前景背景对调） */
  inverse?: boolean
}

/**
 * HTML 转义
 * @param text 原始文本
 * @returns 转义后的文本
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * 把 256 色索引换成 `#rrggbb`
 * @param n 0-255 的调色板索引
 * @returns CSS 颜色
 */
function color256(n: number): string {
  if (n < 16) return FG[n < 8 ? n + 30 : n + 82] ?? "#e5e5e5"
  if (n < 232) {
    const i = n - 16
    const r = CUBE[Math.floor(i / 36) % 6] ?? 0
    const g = CUBE[Math.floor(i / 6) % 6] ?? 0
    const b = CUBE[i % 6] ?? 0
    return `rgb(${r},${g},${b})`
  }
  const level = 8 + (n - 232) * 10
  return `rgb(${level},${level},${level})`
}

/**
 * 消费一条 SGR 序列的参数，更新染色状态
 *
 * 抽出来是因为 38/48（扩展色）会一次吃掉后面好几个参数，写在主循环里会让那层
 * `for` 的下标推进逻辑与颜色逻辑纠缠不清。
 * @param params SGR 数字参数序列
 * @param state 待更新的染色状态（就地修改）
 */
function applySgr(params: number[], state: SgrState): void {
  for (let i = 0; i < params.length; i++) {
    const p = params[i] ?? 0
    if (p === 0) {
      // 重置：清空整个状态
      for (const k of Object.keys(state) as (keyof SgrState)[]) delete state[k]
    } else if (p === 1) state.bold = true
    else if (p === 2) state.dim = true
    else if (p === 3) state.italic = true
    else if (p === 4) state.underline = true
    else if (p === 7) state.inverse = true
    else if (p === 22) { state.bold = false; state.dim = false }
    else if (p === 23) state.italic = false
    else if (p === 24) state.underline = false
    else if (p === 27) state.inverse = false
    else if (p === 39) delete state.fg
    else if (p === 49) delete state.bg
    else if (FG[p]) state.fg = FG[p]
    else if (BG[p]) state.bg = BG[p]
    else if (p === 38 || p === 48) {
      // 38;5;n（256 色）或 38;2;r;g;b（真彩）；48 同理作用于背景
      const mode = params[i + 1]
      if (mode === 5) {
        const idx = params[i + 2] ?? 0
        if (p === 38) state.fg = color256(idx)
        else state.bg = color256(idx)
        i += 2
      } else if (mode === 2) {
        const r = params[i + 2] ?? 0
        const g = params[i + 3] ?? 0
        const b = params[i + 4] ?? 0
        if (p === 38) state.fg = `rgb(${r},${g},${b})`
        else state.bg = `rgb(${r},${g},${b})`
        i += 4
      }
    }
  }
}

/**
 * 把染色状态渲染成 `style` 属性值
 * @param state 染色状态
 * @returns CSS 声明串；无任何样式时为空串
 */
function styleOf(state: SgrState): string {
  const parts: string[] = []
  const fg = state.inverse ? state.bg : state.fg
  const bg = state.inverse ? state.fg : state.bg
  if (fg) parts.push(`color:${fg}`)
  if (bg) parts.push(`background:${bg}`)
  if (state.bold) parts.push("font-weight:bold")
  if (state.dim) parts.push("opacity:.6")
  if (state.italic) parts.push("font-style:italic")
  if (state.underline) parts.push("text-decoration:underline")
  return parts.join(";")
}

/** 匹配所有 ANSI 转义序列（CSI ... 终止字母），全局 */
// eslint-disable-next-line no-control-regex -- ANSI 序列本就以控制字符 ESC(0x1b) 打头，此处正是要匹配它
const ANSI_RE = /\u001b\[([0-9;]*)([A-Za-z])/g

/**
 * 把带 ANSI 的文本转成 HTML
 *
 * 只处理 SGR（终止字母为 `m`）序列，其余（光标、清屏等）当作噪声丢弃。
 * @param input 可能含 ANSI 转义的文本
 * @returns HTML 片段（已转义，可直接嵌入模板）
 */
export function ansiToHtml(input: string): string {
  const state: SgrState = {}
  let out = ""
  let last = 0
  let open = false

  /** 关闭当前 span（若有） */
  const closeSpan = (): void => {
    if (open) {
      out += "</span>"
      open = false
    }
  }
  /** 依当前状态开一个新 span */
  const openSpan = (): void => {
    const style = styleOf(state)
    if (style) {
      out += `<span style="${style}">`
      open = true
    }
  }

  ANSI_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ANSI_RE.exec(input)) !== null) {
    // 先把上一段普通文本按当前样式吐出
    const text = input.slice(last, m.index)
    if (text) out += escapeHtml(text)
    last = m.index + m[0].length

    // 只有 SGR（'m'）改样式；其余序列已被 slice 跳过、等同删除
    if (m[2] === "m") {
      const raw = m[1] ?? ""
      const params = raw === "" ? [0] : raw.split(";").map(n => (n === "" ? 0 : Number(n)))
      closeSpan()
      applySgr(params, state)
      openSpan()
    }
  }
  const tail = input.slice(last)
  if (tail) out += escapeHtml(tail)
  closeSpan()
  return out
}
