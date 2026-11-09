# Annotation Margin · 批注边栏

Select any text to add a note. Notes are collected in a collapsible sidebar, previewed on hover, and can be exported as Markdown, WeChat article HTML, or PDF.

划选任意文字即可添加批注。批注收在右侧边栏，悬停即可预览，点击定位，并可导出为 Markdown、公众号 HTML 或 PDF。

## Features · 功能

| English | 中文 |
| --- | --- |
| Select a word, sentence, or paragraph — a small “Add note to this selection” button appears next to it. | 划选词 / 句 / 段后，选区旁出现「＋ 为这段加入批注」按钮。 |
| Click it and the right sidebar turns into a composer: your selection on top, a text box below, ready to type. | 点它，右侧边栏立刻变成书写区：上方是选中文字，下方输入框已就位。 |
| Press “Done” (or `Ctrl+Enter`) to save. The text gets a soft highlight and the note appears in the sidebar. | 点「我写好了」（或 `Ctrl+Enter`）即保存，正文出现淡色底纹，边栏列出该条。 |
| The sidebar only shows annotations of the **current** note and refreshes when you switch notes. | 边栏只显示**当前笔记**的批注，切换笔记时自动刷新。 |
| Hover an annotated phrase to see a floating preview with a close button; click it to jump to the sidebar entry. | 悬停在批注文字上浮出预览窗（右上角可关闭）；点击则跳到边栏对应条目。 |
| Click a quote in the sidebar to scroll the text into view and flash it. | 点边栏里的灰色引文，正文会滚到该处并闪一下。 |
| Notes follow the file when you rename or move it; if it was moved outside Obsidian, annotations are re-attached by filename once the original text is found again. | 笔记改名/移动时批注自动跟随；在 Obsidian 之外移动的，打开同名笔记时会按「文件名 + 原文仍在」自动回收。 |
| Export: annotation digest as Markdown, WeChat-article HTML with inline styles, or PDF through the core export command. | 导出：批注摘录 Markdown、内联样式的公众号 HTML、或调用系统导出为 PDF。 |
| Two mark styles: soft highlight (default) or dashed underline. | 两种标记样式：淡色底纹（默认）或虚线下划线。 |

## Installation · 安装

**Community plugins** (once listed): Settings → Community plugins → Browse → search **Annotation Margin**.

**BRAT** (available now): install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run `BRAT: Add a beta plugin for testing`, enter `elowenMiMi/annotation-margin`.

**Manual**: copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/annotation-margin/`.

---

**社区插件市场**（上架后）：设置 → 第三方插件 → 浏览 → 搜索 **Annotation Margin**。

**BRAT**（现在就能装）：安装 BRAT 后执行 `BRAT: Add a beta plugin for testing`，填入 `elowenMiMi/annotation-margin`。

**手动安装**：把三个文件放进 `<库>/.obsidian/plugins/annotation-margin/`。

## Usage · 用法

1. Open a note in **Reading view** (`Ctrl+E`). · 用**阅读视图**打开笔记（`Ctrl+E`）。
2. Select text; click the floating button. · 划选文字，点浮动按钮。
3. Type your note, press “Done” or `Ctrl+Enter`. · 写内容，点「我写好了」或按 `Ctrl+Enter`。

Prefer keyboard? Bind a hotkey to the command **Add note to selected text** and skip the floating button.

想走键盘？给命令 **为选中文字添加批注** 绑个快捷键，就不用浮动按钮了。

## Settings · 设置

| English | 中文 |
| --- | --- |
| Annotation folder — where the per-note JSON files live (default `_annotations`). | 批注数据文件夹 —— 每篇笔记一个 JSON（默认 `_annotations`）。 |
| Show hover preview — toggle the floating preview. | 悬停显示批注 —— 开关浮窗预览。 |
| Show floating button on selection — turn off to use only the command/hotkey. | 选中文字时显示浮动按钮 —— 关掉后只用命令/快捷键。 |
| Mark style — highlight or underline. | 标记样式 —— 底色高亮或虚线下划线。 |

## Where the notes live · 批注存在哪

Each note gets one JSON file: `<annotation folder>/ann-<path hash>.json`, containing the quoted text, 24 characters of context on each side (for disambiguation), your note, and timestamps.

**Your Markdown stays clean** — annotations are never written into the note body. Back up the folder to back up the annotations.

---

每篇笔记对应一个 JSON：`<批注文件夹>/ann-<路径哈希>.json`，内含原文片段、前后各 24 字上下文（同词消歧用）、批注内容与时间戳。

**不会写进笔记正文**，所以一篇笔记的 Markdown 始终是干净的；备份该文件夹即备份全部批注。

## Limitations · 已知限制

- Markdown notes only — PDF, Word, and images are not supported. · 仅支持 Markdown 笔记，PDF / Word / 图片不支持。
- If you edit the annotated sentence itself, the highlight may no longer match; the sidebar entry remains and can be re-added. · 手动改动被批注的那句话后，标记可能失效（边栏记录仍在，可删了重加）。
- Live Preview re-renders per line and marks may flicker; Reading view is the stable experience. · 实时预览里标记会随光标行刷新，**阅读视图最稳**。

## License · 许可

MIT
