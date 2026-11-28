# 更新日志

## 0.3.1

**均衡稳定后自动最小化。**

- 当状态进入“已均衡”、增益已经稳定，并且持续 5 秒没有面板操作时，自动收起成小图标。
- 鼠标悬停、拖动或输入时会推迟收起，避免打断操作。
- 自动收起是临时的，不写入用户的手动收起偏好；切换视频后重新展开。
- 手动展开后，本次视频不再自动收起。
- Chromium E2E 增加自动收起断言；`0.3.1` 的 Chromium/iframe 测试通过。

## 0.3.0

**面板交互、直播支持和手动目标响度。**

### 新增

- 面板可按住标题栏拖动，位置会保存到扩展设置。
- 面板可以收起成一个小图标，再点图标展开。
- 增加透明度滑块（30%–100%）。
- 视频全屏时自动收起并贴到屏幕边缘，只留一小条；鼠标移入滑出，移开后再隐藏；退出全屏恢复原来的展开状态和位置。
- 支持 B 站直播：`live.bilibili.com`、`/blackboard/live/`、`/live/`，并支持播放器位于同源 `blanc` iframe 的情况。
- 目标响度增加「手动」挡位，可输入 `-40 … 0 LUFS` 的任意值。
- 同源 iframe 里的 `<video>` 会被顶层脚本找到并接入 Web Audio；iframe 内的点击也能激活 AudioContext。

### 修复

- 修复 `DOMParser` 解析面板时 `<style>` 可能被放进 head、导致 shadow root 没有样式的问题。现在样式节点单独创建，仍不使用 `innerHTML`。
- 全屏时面板会更可靠地移入原生全屏元素；直播 iframe 全屏时会 `adoptNode` 到 iframe 文档，退出后再移回顶层。

### 测试

- 响度算法 7/7 通过。
- Chromium 端到端通过：音频链路、50% 音量补偿，以及拖动、收起/展开、透明度、手动目标、全屏自动收起/贴边隐藏/退出恢复。
- 同源 iframe 端到端通过：跨文档找到 `<video>`、接入 Web Audio、iframe 内点击激活。
- Firefox 端到端沿用 0.2.x 的真实 `web-ext` 临时安装测试；本机未安装 Firefox，未在 0.3.0 上重跑。

## 0.2.1

**上架准备：去掉 `innerHTML` 赋值。**

AMO 的自动校验会把 `innerHTML` 赋值标成 "Unsafe assignment to innerHTML"，并提示可能导致驳回。面板内容是静态模板，不涉及注入，但为了减少审核解释成本，改成：

- 面板骨架用 `DOMParser` 解析后 `append` 到 shadow root，不再赋值 `innerHTML`；
- LUFS 读数只更新独立的文本节点，不再重建内部标记。

功能与 0.2.0 完全相同。`web-ext lint` 的 warning 从 3 条降到 0 条（`innerHTML` 两条消失）。

已上架 addons.mozilla.org：<https://addons.mozilla.org/firefox/addon/b站音量均衡器/>（版本 0.2.1 通过自动审核）。

## 0.2.0

**Firefox 支持。**

### 新增

- Firefox（MV3）支持：清单增加 `browser_specific_settings.gecko`（扩展 ID、`strict_min_version: 140.0`、`data_collection_permissions.required: ["none"]`）。
- `tools/pack.mjs`：一条命令产出两个发布包——`dist/chrome/…zip`（去掉 Firefox 专用键）和 `dist/firefox/…zip`（保留 gecko 配置）。
- `test/e2e/run-firefox.mjs`：用 `web-ext` 在真实 Firefox 里临时安装扩展，跑与 Chromium 等价的端到端断言。
- README 增加 Firefox 安装（临时加载 / 签名）说明；`docs/publishing.md` 增加 AMO 上架与 `web-ext sign` 步骤。

### 改动

- `src/content.js` 增加扩展 API 适配层：Firefox 用 promise 版 `browser.*`，Chrome / Edge 用回调版 `chrome.*`，页面内注入（测试）时退回 `localStorage`。
- AudioWorklet 加载改为三级退让：扩展 URL → 扩展权限 `fetch` 后转 Blob URL → `AnalyserNode` 兼容模式；实际路径记录在 `state.workletMode`。
- `npm run check` 保持零依赖；`web-ext` 只作为 devDependency 供 Firefox E2E 使用。
- 版本号 `0.1.0` → `0.2.0`。

### 测试

- 算法单元测试 7/7 通过。
- Chromium（Edge）端到端通过：安静段 `+15.0 dB`，大声段 `-4.1 dB`，50% 音量下仍为 `-4.1 dB`。
- Firefox 160 端到端通过：扩展临时加载成功，安静段 `+15.0 dB`，大声段 `-4.0 dB`，参考 `-11.8 LUFS`，未退到兼容模式。

## 0.1.0

- 首个版本：B 站网页视频 EBU R128 响度测量、整体增益、限幅保护、按视频 / UP 主缓存。
