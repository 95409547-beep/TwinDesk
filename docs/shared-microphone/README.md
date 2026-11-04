# TwinDesk 共享麦克风研究与首版候选

2026-11-04。上游基线为 `76b69c1d00609d5cb82e9e5cdfe2f42f8257955d`（`2.5.0-beta.1`）；个人 fork 的 `feature/shared-microphone` 分支。

Mac 和 Windows 可跨系统或同系统共享麦克风，支持两台电脑配对和多设备模式。Windows 接收端可选择「其他应用（通话、录音）」或「豆包语音输入」。界面和合成音频已验证，真实双机及豆包转写待验收。

## 分页样式更新

麦克风分页沿用两端 Audio 分页的控件，包括侧栏麦克风图标、页头总开关、关闭时的功能介绍和两张带电脑名称与箭头的方向卡片。Mac 使用 `UI.pair` / `UI.dir`，Windows 使用 `UI.dirCards`；字体、间距、按钮、开关与响应式布局沿用原样式。

两张卡片分别表示“在对方电脑使用本机麦克风”和“在本机使用对方麦克风”。各方向独立开关，总开关同时开关两向；状态通过原版 `pair.sync` 翻转 out/in，在另一台电脑同步，并按配对设备记忆。声源与接收音频设备在所属电脑本地选择。接收用途由接收电脑本地保存。

界面截图使用真实 UI 组件及模拟电脑/设备名称，不代表真机连接。

![Mac 麦克风分页](preview-mac.png)

![Windows 麦克风分页](preview-win.png)

![Windows 豆包语音输入](preview-win-dictation.png)

## 声音转移是怎么实现的

- [mac/audiohub.js](https://github.com/InukaAsith/TwinDesk/blob/76b69c1d00609d5cb82e9e5cdfe2f42f8257955d/mac/audiohub.js)：Mac helper 的 ScreenCaptureKit 系统声音采集由 AudioHub 管理，屏幕与独立声音功能共享一次采集。PCM 通过 fd 3 和 Electron IPC 送进媒体窗口。
- [mac/audio-rtc.js](https://github.com/InukaAsith/TwinDesk/blob/76b69c1d00609d5cb82e9e5cdfe2f42f8257955d/mac/audio-rtc.js)：AudioWorklet → MediaStreamDestination → WebRTC，系统音频使用 Opus，SDP 配置立体声及 128 kbps 目标。
- [windows/sound.js](https://github.com/InukaAsith/TwinDesk/blob/76b69c1d00609d5cb82e9e5cdfe2f42f8257955d/windows/sound.js) / [sound-renderer.js](https://github.com/InukaAsith/TwinDesk/blob/76b69c1d00609d5cb82e9e5cdfe2f42f8257955d/windows/sound-renderer.js)：Windows 系统声音通过 Electron loopback 采集；另一方向用音频播放器播放 WebRTC track。
- 音频策略、SDP、ICE、停止信号经过已有配对连接；媒体另走 WebRTC。两个方向独立，也避免与屏幕声音重复发送。

这里已有的“声音播放转移”没有自动把收到的声音注册为 Windows 录音设备，也没有现有方案里的输入法 Begin/End 控制。

## 和现有方案的取舍

现有 Deskflow Voice 源码比较基线：`54d054927a91085381e77f31a520b61fe379b88c`。当前安装验收依据为其 `docs/build/desktop-preview.md`；历史路线不代替当前源码或设备验证。

| 方面 | TwinDesk 原实现 | 现有 Deskflow Voice | 本次决定 |
|---|---|---|---|
| 主要用途 | 系统声音在另一台电脑播放 | 按住说话，向当前 Windows 输入位置提供语音 | 单独增加“麦克风”，保留原声音页 |
| 网络 | 配对控制连接 + WebRTC/Opus 媒体 | 独立 TLS/V2，48 kHz 单声道 s16le PCM，以 Base64 放入 JSON | 借用既有连接发送协商消息，麦克风用 WebRTC |
| 录音生命周期 | 随声音功能的开关持续运行 | 新的按下开始；松开、切屏、断线等结束 | 候选使用物理 F8 DOWN/UP，跟随当前双机键鼠路由 |
| 接收端 | 音频播放器 | 虚拟音频入口 + 已安装输入法兼容适配 | 两种用途共用虚拟音频设备 |
| 输入法 | 没有此控制 | 已配置双机有真人连续输入及松开停止记录 | 仅检测豆包输入法的安装状态，转写由用户在豆包内开始和结束 |
| 设备与发行 | 已有多平台客户端、配对、媒体和安装工程 | 当前双机有安装记录；干净安装、其他方向等仍有边界 | 先做两端源码候选，真实设备验收后再考虑替换安装 |

不能据源码断言一方端到端延迟、识别率或稳定性一定更好。PCM 这条链路仅原始负载是 768 kbps，Base64 后约 1024 kbps（均不含协议开销）；Opus 能减小语音带宽，但具体码率、起音、尾音和失真仍应实测。新增发送器设置单声道、回声消除、降噪，并尝试为 sender 设置 48 kbps 上限；这不是实际码率测量结果。

## 这次加入的内容

- Mac 和 Windows 客户端在“音频”附近增加中英文“麦克风”页及麦克风图标；总开关、双向卡片和开关同步沿用原版方式，设置即时保存，升级默认关闭。
- 两端都可选择系统可见的麦克风和明确的接收音频设备；设备刷新只列出设备，不打开真实麦克风。
- 指针已移动到对方电脑后，麦克风所属电脑的实体 F8 开始本轮，松开停止；部分键盘需 Fn+F8。Ctrl/Alt/Shift/Command+F8 保留给原应用。
- 使用独立 `mic.*` 协商消息、随机连接 epoch 和会话 ID；拒绝旧路由、旧连接、已结束会话的迟到消息。
- 提前松开或断线时，即使操作系统稍后才返回麦克风授权，返回的 track 也会停止。
- 切回本机、锁屏、睡眠、helper 退出、媒体进程退出、设备消失、撤销接收与 5 秒心跳超时均结束本轮。重连或按键重复不自动重放说话。
- 接收前选择 sink；设备不存在或选择失败时结束本轮，不退回默认扬声器。必须由用户选择音频设备；程序不根据名字猜测驱动身份。
- Windows 在切换为「豆包语音输入」、设置窗口重新获得焦点或刷新音频设备时，读取本机安装信息。「官网下载」按钮打开豆包输入法官方 PC 下载页。
- 媒体窗口独立于屏幕分享，使用隔离持久会话保持设备 ID，限制麦克风/输出权限并禁止导航和新窗口。不改系统默认录音设备、扬声器音量或原声音功能。

麦克风转发使用 Mac / Windows 桌面端之间的 IP 连接。Windows 接收端提供豆包输入法安装检测和下载入口。两端仅列出浏览器可见的标准音频输入；特殊遥控器原始音频不能据此宣称已支持。

## 两端实际使用时的配置

两端都需要包含此分支代码；上游客户端不具备 `mic.*` 接收能力。

1. 两端配对，并开启原有键鼠跨屏功能。打开“麦克风”，使用页头总开关开启。
2. 用两张方向卡片分别允许“对方使用本机麦克风”和“本机使用对方麦克风”。切换会同步对方对应的方向，并按这组电脑记忆。
3. 在声源电脑选择麦克风，在接收电脑选择虚拟音频设备的播放端。在目标应用中使用对应录音端，例如 Windows 的 `CABLE Input` 和 `CABLE Output`。
4. 使用豆包时，在 Windows 接收卡片选择「豆包语音输入」。显示「未安装」时点击「官网下载」，安装完成后回到 TwinDesk 会再次检测。在 Windows 中将虚拟音频设备的录音端设为豆包使用的麦克风。下载入口为 [豆包输入法官网](https://shurufa.doubao.com/pc)。
5. 将指针移到接收电脑，在豆包输入法内开始语音输入，再在声源电脑按住 F8 说话。松开 F8 后 TwinDesk 停止麦克风转发，在豆包内结束转写。部分 Mac 键盘需按 Fn+F8。通话和录音可选择「其他应用（通话、录音）」。

## 三台及以上电脑

在 TwinDesk 的「多设备」页开启多设备模式。从侧栏选中一台 Mac 或 Windows，进入「麦克风」，分别设置本机到它、它到本机的方向。每一对电脑单独保存设置。比如一台 Mac 的麦克风要供两台 Windows 使用，就分别选中两台 Windows，开启 Mac 到各自的方向。

将光标移到目标电脑，再按住 F8，麦克风声音发给当前控制的电脑。切到另一台时，上一轮停止，松开后重新按 F8 可开始下一轮。

## 验证结果与边界

已完成：

- `node shared/test/microphone.js`：设置、按键边沿、提前松开、延迟窗口就绪、路由/epoch、重连、超时、策略撤销、旧 offer 拒绝和输出设备门槛。
- `node shared/test/microphone-mesh.js`：三电脑的独立方向、Windows 对 Windows、路由归属和按住 F8 时切屏。
- `node shared/test/microphone-renderer.js`：延迟授权取消、track 释放、SDP 先于 ICE、输出设备失败且不落回扬声器、先就绪后收音和松键后的尾音处理。
- `mac/node_modules/.bin/electron shared/test/microphone-electron-smoke.js`（已安装 Mac 开发依赖时）：真实 WebRTC/Opus、合成声源、RTP 接收与非零解码能量、松开后两端媒体停止、旧 offer 不重启。Mac 到 Windows、Windows 到 Mac 和 Windows 到 Windows 均通过；接收 sink 在测试中模拟，未打开真实麦克风。
- `mac/node_modules/.bin/electron shared/test/microphone-ui-smoke.js`（已安装 Mac 开发依赖时）：真实 Mac/Windows UI kit 的图标、页头总开关、原版关闭介绍、两张电脑方向卡、独立开关、设备选择及刷新操作；Windows 界面在 macOS Electron 中使用模拟设备和豆包安装状态，覆盖检测中、已安装、未安装和官网下载按钮操作。
- `sh mac-helper/build.sh`：单机、MULTI 和配套工具构建通过；上游已有 `main.swift:202` 可选值转换警告保留。
- 既有 `peer-kvm-auth`、`lazy-features`、`sidebar-model`、`i18n`、`i18n-integration`、`i18n-mac-shell`、`i18n-mac-features` 回归通过；变更 JS 语法及 `git diff --check` 通过。

双向共享和豆包模式均通过 Electron 合成音频测试，接收音频设备使用模拟数据。Windows 自动化检查覆盖输入法安装项、普通豆包客户端和移除安装项。旧版验证记录保存在 [validation-v3.json](validation-v3.json)、[validation-v2.json](validation-v2.json) 和 [validation.json](validation.json)。

实体电脑组网、实际虚拟音频设备、跨屏 F8 和豆包转写仍待真机验收。
