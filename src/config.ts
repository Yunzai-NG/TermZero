/**
 * 模块职责：本插件的配置 schema —— 远程执行的几项开关与限额
 * 依赖方向：仅依赖 `@yunzai-ng/core` 的 schema 工具
 * 生命周期：模块加载期构造一次，之后只读
 * 注意事项：**这几条命令都是「主人专属的口子」，本身即高危。** 配置项因此都往"更安全"的方向留了
 *          余地：输出有长度上限（不至于把几十 MB 的日志一次性回给平台被风控），Shell 有超时
 *          （一条写死循环的命令不会把机器人挂住），图片有页高上限（超长输出分页而非拼一张几万像素
 *          的巨图）。这些默认值是经验值，改小是安全的，改大请自负其责。
 *
 *          **没有「启用/禁用」开关。** 是否加载本插件本就由「装不装它」决定；再加一个运行期开关只是
 *          把同一个决定挪到两个地方，反而容易出现"装了却忘了开"的困惑。要停用就卸载插件。
 */

import { s } from "@yunzai-ng/core"
import type { Infer } from "@yunzai-ng/core"
import type { DeepReadonly } from "@yunzai-ng/types"

/** 本插件的配置 schema */
export const CONFIG_SCHEMA = s.object({
  /* ────────────────────────────── Shell ────────────────────────────── */

  shell: s
    .object({
      timeout: s
        .duration()
        .default("60s")
        .title("命令超时")
        .desc("单条 Shell 命令跑多久算超时。超时后进程被杀掉并回报，避免一条卡住的命令把机器人挂住"),
      encoding: s
        .select([
          { value: "utf8", label: "UTF-8", description: "绝大多数系统的默认，中文不乱码" },
          { value: "latin1", label: "Latin-1", description: "某些老旧 Windows 控制台程序才需要" }
        ])
        .default("utf8")
        .title("输出编码")
        .desc("子进程标准输出/错误的解码方式。乱码时才需要改动")
    })
    .title("Shell 执行")
    .group("Shell")
    .order(10),

  /* ────────────────────────────── 外观 ────────────────────────────── */

  appearance: s
    .object({
      background: s
        .select([
          {
            value: "gradient",
            label: "渐变（离线）",
            description: "纯 CSS 深色渐变 + 网格，不联网、出图最快最稳。默认"
          },
          {
            value: "image",
            label: "图片 / 壁纸 API",
            description: "用下方链接作背景图；取图失败会自动退回渐变，但联网取图会拖慢出图、极端情况下渲染超时会退回纯文本"
          }
        ])
        .default("gradient")
        .title("背景")
        .desc("出图（rjp / rcp / sc）面板后面的背景。想要花哨壁纸就选「图片 / 壁纸 API」并填下面的链接"),
      backgroundUrl: s
        .string()
        .default("https://t.mwm.moe/pc")
        .title("背景图链接")
        .desc(
          "背景选「图片 / 壁纸 API」时使用。可填一张固定图片的直链，也可填每次返回随机图的壁纸 API" +
            "（如默认的 https://t.mwm.moe/pc）。留空则退回渐变"
        )
    })
    .title("外观")
    .group("外观")
    .order(15),

  /* ────────────────────────────── 输出 ────────────────────────────── */

  output: s
    .object({
      maxTextLength: s
        .number()
        .int()
        .min(0)
        .max(50_000)
        .default(10_000)
        .title("文本回复上限")
        .desc(
          "纯文本（rj / rc）回复超过这么多字符就截断并提示改用出图版（rjp / rcp）。" +
            "填 0 表示不截断 —— 但过长的文本极易被平台判为刷屏，谨慎"
        ),
      pageHeight: s
        .number()
        .int()
        .min(2_000)
        .max(60_000)
        .default(20_000)
        .title("长图页高")
        .desc("出图（rjp / rcp / sc / md）时单页最大像素高度，超出即分页。20000 是个够用的量级")
    })
    .title("输出限制")
    .group("输出")
    .order(20),

  /* ────────────────────────────── Markdown ────────────────────────────── */

  markdown: s
    .object({
      fetchTimeout: s
        .duration()
        .default("15s")
        .title("下载超时")
        .desc("`md` 接一个 http(s) 链接时，下载该文档的超时时间"),
      maxBytes: s
        .number()
        .int()
        .min(1_024)
        .max(20 * 1_024 * 1_024)
        .default(2 * 1_024 * 1_024)
        .title("下载体积上限")
        .desc("远程 Markdown 文档最大下载多少字节，超出即拒绝，避免误接一个大文件把内存吃满")
    })
    .title("Markdown 渲染")
    .group("Markdown")
    .order(30)
})

/**
 * 本插件的配置类型，由 schema 推导，不另手写第二份
 *
 * **`Infer` 给的是可写形态，`ctx.config.get()` 返回的是它的 `DeepReadonly`。** 从上下文取到配置
 * 再往下传时，参数类型用 {@link TermZeroConfigRO}——用可写那份会在只读字段上报类型不兼容。
 */
export type TermZeroConfig = Infer<typeof CONFIG_SCHEMA>

/** 从 `ctx.config.get()` 取到的只读配置 */
export type TermZeroConfigRO = DeepReadonly<TermZeroConfig>
