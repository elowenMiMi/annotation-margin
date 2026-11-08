const obsidian = require("obsidian");

const VIEW_TYPE = "am-notes-view";

const DEFAULT_SETTINGS = {
  dataFolder: "_annotations",
  hoverPreview: true,
  showSelectionToolbar: true,
  markStyle: "highlight" // highlight | underline
};

/* ============================================================
 * 纯函数（可单独测试）
 * ============================================================ */

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 在 hay 中定位 text；用 prefix/suffix 上下文消歧。返回起始下标或 -1 */
function findMatch(hay, text, prefix, suffix) {
  if (!text || !hay) return -1;
  let from = 0;
  while (from <= hay.length) {
    const i = hay.indexOf(text, from);
    if (i < 0) return -1;
    const before = hay.slice(Math.max(0, i - (prefix || "").length), i);
    const after = hay.slice(i + text.length, i + text.length + (suffix || "").length);
    const okPre = !prefix || before.endsWith(prefix);
    const okSuf = !suffix || after.startsWith(suffix);
    if (okPre && okSuf) return i;
    from = i + 1;
  }
  return -1;
}

function contextOf(hay, start, end, n) {
  return {
    prefix: hay.slice(Math.max(0, start - n), start),
    suffix: hay.slice(end, end + n)
  };
}

function newId() {
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function htmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 把渲染出来的 HTML 元素统一加内联样式（公众号编辑器只认内联样式） */
function styleForWechat(root) {
  const map = {
    h1: "font-size:20px;font-weight:700;margin:26px 0 12px;line-height:1.4;",
    h2: "font-size:18px;font-weight:700;margin:24px 0 10px;line-height:1.45;padding-left:9px;border-left:4px solid #57606a;",
    h3: "font-size:16px;font-weight:700;margin:20px 0 8px;line-height:1.5;",
    h4: "font-size:15px;font-weight:700;margin:16px 0 6px;",
    h5: "font-size:15px;font-weight:700;margin:14px 0 6px;",
    h6: "font-size:15px;font-weight:700;margin:14px 0 6px;",
    p: "margin:0 0 14px;font-size:16px;line-height:1.85;",
    blockquote: "margin:0 0 14px;padding:10px 14px;border-left:3px solid #d0d7de;background:#f6f8fa;color:#57606a;font-size:15px;line-height:1.75;",
    ul: "margin:0 0 14px;padding-left:22px;",
    ol: "margin:0 0 14px;padding-left:22px;",
    li: "margin:4px 0;font-size:16px;line-height:1.8;",
    strong: "font-weight:700;",
    em: "font-style:italic;",
    a: "color:#57606a;text-decoration:underline;",
    hr: "border:none;border-top:1px solid #e5e7eb;margin:22px 0;",
    code: "background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:15px;",
    pre: "background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto;font-size:14px;line-height:1.6;",
    table: "border-collapse:collapse;width:100%;margin:0 0 14px;font-size:15px;",
    thead: "",
    tbody: "",
    tr: "",
    td: "border:1px solid #e5e7eb;padding:6px 8px;",
    th: "border:1px solid #e5e7eb;padding:6px 8px;background:#f6f8fa;font-weight:700;",
    img: "max-width:100%;height:auto;display:block;margin:0 auto 14px;border-radius:4px;",
    span: ""
  };
  const els = root.querySelectorAll ? root.querySelectorAll("*") : [];
  for (const el of els) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (Object.prototype.hasOwnProperty.call(map, tag)) el.setAttribute("style", map[tag]);
    el.removeAttribute("class");
    el.removeAttribute("data-am-id");
    el.removeAttribute("data-am-src");
  }
}

/* ============================================================
 * DOM 辅助
 * ============================================================ */

function walkTextNodes(root) {
  const out = [];
  let pos = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    const len = (n.nodeValue || "").length;
    if (len) out.push({ node: n, start: pos, end: pos + len });
    pos += len;
  }
  return out;
}

/** 把 root 中 [start,end) 的文字包进 <span class=cls>，从后往前处理保证偏移不失效 */
function wrapRange(root, start, end, cls, attrs) {
  const nodes = walkTextNodes(root);
  const targets = nodes.filter((x) => x.end > start && x.start < end);
  for (let k = targets.length - 1; k >= 0; k--) {
    const seg = targets[k];
    const ns = Math.max(start, seg.start) - seg.start;
    const ne = Math.min(end, seg.end) - seg.start;
    let node = seg.node;
    if (!node.parentNode) continue;
    if (ns > 0) node = node.splitText(ns);
    const keep = node.nodeValue.length;
    if (ne - ns < keep) node.splitText(ne - ns);
    const span = document.createElement("span");
    span.className = cls;
    if (attrs) for (const key of Object.keys(attrs)) span.setAttribute(key, attrs[key]);
    node.parentNode.insertBefore(span, node);
    span.appendChild(node);
  }
}

/* ============================================================
 * 批注编辑弹窗
 * ============================================================ */

class NoteEditorModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    this.value = opts.initial || "";
  }

  onOpen() {
    const c = this.contentEl;
    c.addClass("am-modal");
    c.createEl("h3", { text: this.opts.title || "批注" });
    if (this.opts.quote) {
      const q = c.createDiv({ cls: "am-modal-quote" });
      q.setText(this.opts.quote.length > 180 ? this.opts.quote.slice(0, 180) + "…" : this.opts.quote);
    }
    this.ta = c.createEl("textarea", { cls: "am-modal-input" });
    this.ta.value = this.value;
    this.ta.rows = 5;
    this.ta.focus();

    const bar = c.createDiv({ cls: "am-modal-bar" });
    const save = bar.createEl("button", { text: "保存", cls: "mod-cta" });
    save.onclick = () => {
      const v = this.ta.value.trim();
      if (!v) new obsidian.Notice("批注内容为空");
      else {
        this.opts.onSave(v);
        this.close();
      }
    };
    if (this.opts.onDelete) {
      const del = bar.createEl("button", { text: "删除批注" });
      del.onclick = () => {
        this.opts.onDelete();
        this.close();
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ============================================================
 * 公众号 HTML 预览 / 复制
 * ============================================================ */

class HtmlPreviewModal extends obsidian.Modal {
  constructor(app, title, html) {
    super(app);
    this.titleText = title;
    this.html = html;
  }

  onOpen() {
    const c = this.contentEl;
    c.addClass("am-modal");
    c.createEl("h3", { text: "公众号 HTML · " + this.titleText });
    c.createEl("p", {
      cls: "am-hint",
      text: "样式已全部内联，复制后直接粘贴到公众号后台编辑器即可；不依赖任何外部 CSS。"
    });
    const ta = c.createEl("textarea", { cls: "am-html-ta" });
    ta.value = this.html; // 故意用 value 赋值：保持源码可复制
    const bar = c.createDiv({ cls: "am-modal-bar" });
    const copy = bar.createEl("button", { text: "复制到剪贴板", cls: "mod-cta" });
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(this.html);
        new obsidian.Notice("已复制，去公众号后台粘贴");
      } catch (e) {
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy");
          new obsidian.Notice("已复制（回退方式）");
        } catch (e2) {
          new obsidian.Notice("复制失败，请手动全选复制");
        }
      }
    };
    const sel = bar.createEl("button", { text: "全选" });
    sel.onclick = () => {
      ta.focus();
      ta.select();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ============================================================
 * 右侧边栏视图
 * ============================================================ */

class NotesView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.highlightId = null;
    this.draft = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "批注";
  }

  getIcon() {
    return "sticky-note";
  }

  async onOpen() {
    this.render();
  }

  async onClose() { }

  render() {
    const root = this.containerEl.children[1];
    if (!root) return;
    root.empty();
    root.addClass("am-view");

    const head = root.createDiv({ cls: "am-view-head" });
    head.createEl("span", { text: "批注", cls: "am-view-title" });
    const closeBtn = head.createEl("button", { text: "×", cls: "am-view-close" });
    closeBtn.setAttribute("aria-label", "关闭批注边栏");
    closeBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.leaf.detach();
    };

    // ---- 书写态：直接在这里写 ----
    if (this.draft) {
      this.renderComposer(root);
      return;
    }

    const file = this.app.workspace.getActiveFile();
    const body = root.createDiv({ cls: "am-view-body" });
    if (!file) {
      body.createDiv({ cls: "am-empty", text: "先打开一篇笔记" });
      return;
    }
    const items = this.plugin.store.get(file.path) || [];
    if (!items.length) {
      body.createDiv({
        cls: "am-empty",
        text: "这篇笔记还没有批注。\n\n用鼠标划选一段文字，旁边会出现「＋ 为这段加入批注」。"
      });
      return;
    }

    body.createDiv({ cls: "am-view-file", text: file.basename });
    for (const a of items) {
      const card = body.createDiv({ cls: "am-card" });
      if (a.id === this.highlightId) card.addClass("is-active");

      const quote = card.createDiv({ cls: "am-card-quote" });
      quote.setText(a.text.length > 80 ? a.text.slice(0, 80) + "…" : a.text);
      quote.onclick = () => this.plugin.locate(a.id);

      const note = card.createDiv({ cls: "am-card-note" });
      note.setText(a.note);

      const bar = card.createDiv({ cls: "am-card-bar" });
      const edit = bar.createEl("button", { text: "编辑" });
      edit.onclick = (ev) => {
        ev.stopPropagation();
        this.plugin.editAnn(a, file.path);
      };
      const del = bar.createEl("button", { text: "删除" });
      del.onclick = async (ev) => {
        ev.stopPropagation();
        await this.plugin.removeAnn(a, file.path);
      };
    }
  }

  renderComposer(root) {
    const d = this.draft;
    const box = root.createDiv({ cls: "am-compose" });

    const q = box.createDiv({ cls: "am-compose-quote" });
    q.setText(d.text.length > 160 ? d.text.slice(0, 160) + "…" : d.text);

    const ta = box.createEl("textarea", { cls: "am-compose-input" });
    ta.placeholder = "写点想法…（Ctrl+Enter 直接保存）";
    ta.rows = 8;
    this.inputEl = ta;
    window.setTimeout(() => ta.focus(), 40);

    const bar = box.createDiv({ cls: "am-compose-bar" });
    const cancel = bar.createEl("button", { text: "取消" });
    cancel.onclick = () => this.plugin.cancelCompose();

    const save = bar.createEl("button", { text: "我写好了", cls: "mod-cta am-compose-save" });
    save.onclick = () => this.plugin.commitDraft(d, ta.value);

    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        this.plugin.commitDraft(d, ta.value);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.plugin.cancelCompose();
      }
    });
  }

  compose(draft) {
    this.draft = draft;
    this.render();
    const root = this.containerEl.children[1];
    const ta = root && root.querySelector ? root.querySelector(".am-compose-input") : null;
    if (ta && ta.focus) ta.focus();
  }

  focus(id) {
    this.highlightId = id;
    this.render();
  }
}

/* ============================================================
 * 设置页
 * ============================================================ */

class AmSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const el = this.containerEl;
    el.empty();
    const ver = (this.plugin.manifest && this.plugin.manifest.version) || "";
    el.createEl("h2", { text: "批注边栏" + (ver ? "  v" + ver : "") });

    new obsidian.Setting(el)
      .setName("批注数据文件夹")
      .setDesc("每条批注存成一个 json 文件，按笔记路径哈希命名")
      .addText((t) =>
        t.setValue(this.plugin.settings.dataFolder).onChange(async (v) => {
          this.plugin.settings.dataFolder = v.trim() || DEFAULT_SETTINGS.dataFolder;
          await this.plugin.saveSettings();
        })
      );

    new obsidian.Setting(el)
      .setName("悬停显示批注")
      .setDesc("鼠标移到标记上时浮出小窗预览")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.hoverPreview).onChange(async (v) => {
          this.plugin.settings.hoverPreview = v;
          await this.plugin.saveSettings();
        })
      );

    new obsidian.Setting(el)
      .setName("选中文字时显示浮动按钮")
      .setDesc("划选后旁边出现「＋ 为这段加入批注」，点它就在右侧直接写")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showSelectionToolbar).onChange(async (v) => {
          this.plugin.settings.showSelectionToolbar = v;
          await this.plugin.saveSettings();
          if (!v) this.plugin.hideToolbar();
        })
      );

    new obsidian.Setting(el)
      .setName("标记样式")
      .setDesc("被批注文字的高亮方式")
      .addDropdown((d) => {
        d.addOption("highlight", "底色高亮");
        d.addOption("underline", "虚线下划线");
        d.setValue(this.plugin.settings.markStyle).onChange(async (v) => {
          this.plugin.settings.markStyle = v;
          await this.plugin.saveSettings();
          this.plugin.applyBodyClass();
          this.plugin.rerender();
        });
      });

    new obsidian.Setting(el)
      .setName("重新应用标记")
      .setDesc("改完设置或从外部修改了 json 后点一下")
      .addButton((b) => b.setButtonText("刷新").onClick(() => this.plugin.rerender(true)));
  }
}

/* ============================================================
 * 插件主体
 * ============================================================ */

class AnnotationMarginPlugin extends obsidian.Plugin {
  async onload() {
    try {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
      this.store = new Map();      // sourcePath -> items[]
      this.popover = null;
      this.hideTimer = null;

      this.registerView(VIEW_TYPE, (leaf) => new NotesView(leaf, this));

      this.addRibbonIcon("sticky-note", "批注边栏", () => this.activateView());

      this.addCommand({ id: "am-add", name: "为选中文字添加批注", callback: () => this.addFromSelection() });
      this.addCommand({ id: "am-open", name: "打开批注边栏", callback: () => this.activateView() });
      this.addCommand({ id: "am-refresh", name: "重新应用批注标记", callback: () => this.rerender(true) });
      this.addCommand({ id: "am-export-md", name: "导出批注为 Markdown 文件", callback: () => this.exportAnnotationsMarkdown() });
      this.addCommand({ id: "am-export-wx-ann", name: "导出批注摘录为公众号 HTML", callback: () => this.exportWechat("annotations") });
      this.addCommand({ id: "am-export-wx-full", name: "导出当前文档全文为公众号 HTML", callback: () => this.exportWechat("full") });
      this.addCommand({ id: "am-export-pdf", name: "导出当前笔记为 PDF", callback: () => this.exportPdf() });
      this.addCommand({ id: "am-diag", name: "诊断：为什么划选后没有出现按钮", callback: () => this.diagnose() });
      this.addCommand({ id: "am-clean", name: "清理孤立批注数据（原笔记已删除）", callback: () => this.cleanOrphans() });

      this.registerMarkdownPostProcessor((el, ctx) => this.decorate(el, ctx));

      this.registerDomEvent(document, "click", (ev) => this.onDocClick(ev), true);
      this.registerDomEvent(document, "mouseover", (ev) => this.onHover(ev));
      this.registerDomEvent(document, "mouseout", (ev) => this.onLeave(ev));
      this.registerDomEvent(document, "mouseup", (ev) => this.onMouseUp(ev), true);
      this.registerDomEvent(document, "keyup", (ev) => {
        if (ev.key === "Escape") {
          this.hideToolbar();
          return;
        }
        // 键盘选择（Shift+方向键）也要能出按钮
        if (ev.shiftKey && /^Arrow|^Home$|^End$/.test(ev.key)) this.onMouseUp(ev);
      });
      this.registerDomEvent(document, "selectionchange", () => {
        const s = window.getSelection();
        if (!s || s.isCollapsed) this.hideToolbar();
      });
      this.registerDomEvent(document, "scroll", () => {
        this.hidePopover();
        this.hideToolbar();
      }, true);

      this.registerEvent(
        this.app.workspace.on("file-open", (f) => {
          if (f) this.prime(f.path);
          this.refreshView();
        })
      );
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          const f = this.app.workspace.getActiveFile();
          if (f) this.prime(f.path);
          this.refreshView();
        })
      );

      // 笔记被移动/改名时，批注跟着走（收件箱自动整理会移动文件）
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (!file || file.extension !== "md") return;
          this._orphans = null;
          this.migrateStore(oldPath, file.path)
            .then(() => {
              this._orphans = null;
              this.refreshView();
            })
            .catch((e) => console.error("[批注边栏] 迁移失败", e));
        })
      );

      this.addSettingTab(new AmSettingTab(this.app, this));
      this.applyBodyClass();

      // 更新后首次加载给个提示，方便确认新代码已生效
      const cur = (this.manifest && this.manifest.version) || "";
      if (cur && this.settings.lastVersion !== cur) {
        this.settings.lastVersion = cur;
        await this.saveData(this.settings);
        new obsidian.Notice("批注边栏已更新到 v" + cur + "：划选文字，旁边会出现「＋ 为这段加入批注」", 8000);
      }

      const f = this.app.workspace.getActiveFile();
      if (f) this.prime(f.path);
    } catch (e) {
      console.error("[批注边栏] onload 失败", e);
      new obsidian.Notice("批注边栏启动失败：" + (e && e.message ? e.message : e));
      throw e;
    }
  }

  onunload() {
    this.hidePopover();
    this.hideToolbar();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  applyBodyClass() {
    document.body.classList.toggle("am-style-underline", this.settings.markStyle === "underline");
    document.body.classList.toggle("am-style-highlight", this.settings.markStyle !== "underline");
  }

  /* ---------- 存读 ---------- */

  dir() {
    return (this.settings.dataFolder || DEFAULT_SETTINGS.dataFolder).replace(/\/+$/, "");
  }

  pathFor(source) {
    return this.dir() + "/ann-" + hash32(source) + ".json";
  }

  async readStore(source) {
    const p = this.pathFor(source);
    const f = this.app.vault.getAbstractFileByPath(p);
    if (!(f instanceof obsidian.TFile)) return [];
    try {
      const j = JSON.parse(await this.app.vault.read(f));
      return Array.isArray(j.items) ? j.items : [];
    } catch (e) {
      console.error("[批注边栏] 读取批注失败", p, e);
      return [];
    }
  }

  async writeStore(source, items) {
    const dir = this.dir();
    if (!this.app.vault.getAbstractFileByPath(dir)) {
      try {
        await this.app.vault.createFolder(dir);
      } catch (e) { /* 已存在 */ }
    }
    const p = this.pathFor(source);
    const body = JSON.stringify({ source, version: 1, updated: Date.now(), items }, null, 1);
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof obsidian.TFile) await this.app.vault.modify(f, body);
    else await this.app.vault.create(p, body);
  }

  async prime(source) {
    if (this.store.has(source)) return this.store.get(source);
    let items = await this.readStore(source);
    if (!items.length) {
      const adopted = await this.tryAdopt(source);
      if (adopted && adopted.length) items = adopted;
    }
    this.store.set(source, items);
    if (items.length) this.rerender();
    return items;
  }

  /* ---------- 在 Obsidian 之外被移动/改名时，按文件名回收批注 ---------- */

  async indexOrphans(force) {
    if (this._orphans && !force) return this._orphans;
    const map = new Map();
    const dir = this.dir();
    try {
      const listing = await this.app.vault.adapter.list(dir);
      for (const p of listing.files || []) {
        if (!String(p).endsWith(".json")) continue;
        try {
          const j = JSON.parse(await this.app.vault.adapter.read(p));
          const src = j && j.source;
          if (!src) continue;
          const base = src.split("/").pop().replace(/\.md$/, "");
          if (!map.has(base)) map.set(base, []);
          map.get(base).push({ jsonPath: p, source: src, items: j.items || [] });
        } catch (e) { /* 跳过坏文件 */ }
      }
    } catch (e) { /* 目录还不存在 */ }
    this._orphans = map;
    return map;
  }

  async tryAdopt(source) {
    const file = this.app.vault.getAbstractFileByPath(source);
    if (!(file instanceof obsidian.TFile)) return null;
    const base = source.split("/").pop().replace(/\.md$/, "");
    const map = await this.indexOrphans();
    const cands = (map.get(base) || []).filter((c) => c.source !== source && c.items.length);
    if (!cands.length) return null;

    let text = "";
    try {
      text = await this.app.vault.cachedRead(file);
    } catch (e) {
      return null;
    }
    for (const c of cands) {
      const hit = c.items.filter((a) => findMatch(text, a.text, a.prefix || "", a.suffix || "") >= 0);
      if (!hit.length) continue;
      await this.writeStore(source, c.items);
      const old = this.app.vault.getAbstractFileByPath(c.jsonPath);
      if (old instanceof obsidian.TFile) {
        try {
          await this.app.vault.delete(old);
        } catch (e) { /* ignore */ }
      }
      this._orphans = null;
      new obsidian.Notice("已按文件名回收 " + c.items.length + " 条批注（原路径：" + c.source + "）", 6000);
      return c.items;
    }
    return null;
  }

  async cleanOrphans() {
    const map = await this.indexOrphans(true);
    const gone = [];
    for (const list of map.values()) {
      for (const c of list) {
        if (!(this.app.vault.getAbstractFileByPath(c.source) instanceof obsidian.TFile)) {
          gone.push(c);
        }
      }
    }
    if (!gone.length) {
      new obsidian.Notice("没有孤立批注数据，很干净");
      return;
    }
    for (const c of gone) {
      const f = this.app.vault.getAbstractFileByPath(c.jsonPath);
      if (f instanceof obsidian.TFile) {
        try {
          await this.app.vault.delete(f);
        } catch (e) { /* ignore */ }
      }
    }
    this._orphans = null;
    new obsidian.Notice("已清理 " + gone.length + " 份孤立批注（原笔记已不存在）");
  }

  async reload(source) {
    this.store.delete(source);
    const items = await this.readStore(source);
    this.store.set(source, items);
    this.rerender();
    this.refreshView();
    return items;
  }

  /* ---------- 渲染标记 ---------- */

  decorate(el, ctx) {
    const src = ctx && ctx.sourcePath;
    if (!src) return;
    const items = this.store.get(src);
    if (!items || !items.length) return;
    if (el.closest && el.closest(".am-popover")) return;
    const hay = el.textContent || "";
    if (!hay) return;

    const hits = [];
    for (const a of items) {
      const i = findMatch(hay, a.text, a.prefix || "", a.suffix || "");
      if (i >= 0) hits.push({ a, start: i, end: i + a.text.length });
    }
    if (!hits.length) return;
    hits.sort((x, y) => y.start - x.start);
    for (const h of hits) {
      try {
        wrapRange(el, h.start, h.end, "am-mark", { "data-am-id": h.a.id, "data-am-src": src });
      } catch (e) {
        console.warn("[批注边栏] 标记失败", e);
      }
    }
  }

  rerender(clearCache) {
    if (clearCache) this.store.clear();
    const mv = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (mv) {
      try {
        if (mv.previewMode && mv.previewMode.rerender) mv.previewMode.rerender(true);
        else mv.previewMode = mv.previewMode;
      } catch (e) { /* ignore */ }
    }
    const f = this.app.workspace.getActiveFile();
    if (f) this.prime(f.path);
  }

  /* ---------- 新建批注：划选 → 浮动按钮 → 右侧直接写 ---------- */

  /** 从当前选区抓取锚点；不满足条件返回 null */
  captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;

    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    if (!node || !node.closest) return null;

    // 排除：批注侧栏、浮窗、弹窗、输入框、浮动按钮
    if (node.closest(".am-view,.am-popover,.am-modal,.modal-container,.am-toolbar")) return null;
    if (node.closest("input,textarea")) return null;
    // 排除右侧/左侧边栏（文件列表等）
    if (node.closest(".mod-right-split,.mod-left-split,.workspace-ribbon")) return null;

    const mv = this.findMarkdownViewFor(node);
    if (!mv) return null;

    const anchorEl = node.closest("p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th") || node;
    const hay = anchorEl.textContent || "";
    let start = hay.indexOf(text);
    try {
      const pre = document.createRange();
      pre.selectNodeContents(anchorEl);
      pre.setEnd(range.startContainer, range.startOffset);
      start = pre.toString().length;
    } catch (e) { /* 跨元素选择时退化 */ }
    if (start < 0 || hay.slice(start, start + text.length) !== text) start = hay.indexOf(text);
    if (start < 0) return null;

    const ctx = contextOf(hay, start, start + text.length, 24);
    const rect = range.getBoundingClientRect();
    return {
      text,
      prefix: ctx.prefix,
      suffix: ctx.suffix,
      source: mv.file ? mv.file.path : "",
      rect
    };
  }

  /** 找到选区所属的 MarkdownView（不依赖“活动视图”是谁） */
  findMarkdownViewFor(node) {
    const ws = this.app.workspace;
    const active = ws.getActiveViewOfType(obsidian.MarkdownView);
    if (active && active.containerEl && active.containerEl.contains(node)) return active;
    try {
      for (const leaf of ws.getLeavesOfType("markdown")) {
        const v = leaf.view;
        if (v && v.containerEl && v.containerEl.contains(node)) return v;
      }
    } catch (e) { /* ignore */ }
    return active && active.containerEl && !node.closest(".mod-right-split,.mod-left-split") ? active : null;
  }

  /* ---------- 选区浮动按钮 ---------- */

  onMouseUp(ev) {
    if (!this.settings.showSelectionToolbar) return;
    const t = ev && ev.target;
    if (t && t.closest && (t.closest(".am-toolbar") || t.closest(".am-view"))) return;
    if (this._mouseupTimer) window.clearTimeout(this._mouseupTimer);
    this._mouseupTimer = window.setTimeout(() => {
      const draft = this.captureSelection();
      if (!draft) {
        this.hideToolbar();
        return;
      }
      this.showToolbar(draft);
    }, 80);
  }

  showToolbar(draft) {
    this.hideToolbar();
    const rect = draft.rect;
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    const bar = document.createElement("div");
    bar.className = "am-toolbar";

    const btn = document.createElement("button");
    btn.className = "am-toolbar-btn";
    btn.textContent = "＋ 为这段加入批注";
    btn.onmousedown = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._pendingDraft = draft;
    };
    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const d = this._pendingDraft || draft;
      this._pendingDraft = null;
      this.hideToolbar();
      if (d) this.startCompose(d);
    };

    bar.appendChild(btn);
    document.body.appendChild(bar);
    this.toolbar = bar;

    let left = rect.left + rect.width / 2;
    left = Math.max(96, Math.min(left, window.innerWidth - 96));
    let top = rect.top - 10;
    if (top < 48) top = rect.bottom + 10;
    bar.style.left = left + "px";
    bar.style.top = top + "px";
  }

  hideToolbar() {
    if (this._mouseupTimer) {
      window.clearTimeout(this._mouseupTimer);
      this._mouseupTimer = null;
    }
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
  }

  /** 诊断：为什么按钮没出现 */
  diagnose() {
    const out = [];
    const ver = (this.manifest && this.manifest.version) || "?";
    out.push("插件版本: v" + ver);
    out.push("浮动按钮开关: " + (this.settings.showSelectionToolbar ? "开" : "关"));

    const sel = window.getSelection();
    if (!sel) {
      out.push("选区: 浏览器没有返回选区");
    } else if (sel.isCollapsed || sel.rangeCount === 0) {
      out.push("选区: 已折叠（没有选中文字）——请先划选");
    } else {
      const text = sel.toString().trim();
      out.push("选区: 「" + text.slice(0, 24) + "」(" + text.length + " 字)");
      let node = sel.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentNode;
      out.push("选区元素: <" + (node.tagName || "?") + "> class=" + String(node.className || "").slice(0, 60));
      const mv = this.findMarkdownViewFor(node);
      out.push("所属 Markdown 视图: " + (mv ? "找到" : "没找到 ← 这就是原因"));
      const d = this.captureSelection();
      out.push("能否抓取锚点: " + (d ? "能" : "不能"));
    }
    const msg = out.join("\n");
    console.log("[批注边栏·诊断]\n" + msg);
    new obsidian.Notice(msg, 15000);
  }

  /* ---------- 书写流程 ---------- */

  startCompose(draft) {
    this.activateView(null, draft);
  }

  cancelCompose() {
    const view = this.getView();
    if (view) {
      view.draft = null;
      view.render();
    }
  }

  async commitDraft(draft, rawNote) {
    const note = String(rawNote == null ? "" : rawNote).trim();
    if (!note) {
      new obsidian.Notice("还空着，写点什么再点「我写好了」");
      return;
    }
    const src = draft.source || (this.app.workspace.getActiveFile() || {}).path;
    if (!src) {
      new obsidian.Notice("找不到所属笔记");
      return;
    }
    const id = newId();
    const items = this.store.get(src) || (await this.prime(src)) || [];
    items.push({
      id,
      text: draft.text,
      prefix: draft.prefix || "",
      suffix: draft.suffix || "",
      note,
      created: Date.now(),
      updated: Date.now()
    });
    this.store.set(src, items);
    await this.writeStore(src, items);

    const view = this.getView();
    if (view) {
      view.draft = null;
      view.render();
      view.focus(id);
    }
    this.rerender();
    new obsidian.Notice("已加入批注");
  }

  getView() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return leaf ? leaf.view : null;
  }

  /** 兼容旧命令：不弹窗，直接进入右侧书写 */
  async addFromSelection() {
    const draft = this.captureSelection();
    if (!draft) {
      new obsidian.Notice("请先用鼠标划选一段文字");
      return;
    }
    this.startCompose(draft);
  }

  editAnn(ann, source) {
    new NoteEditorModal(this.app, {
      title: "编辑批注",
      quote: ann.text,
      initial: ann.note,
      onSave: async (v) => {
        ann.note = v;
        ann.updated = Date.now();
        await this.writeStore(source, this.store.get(source) || []);
        this.refreshView();
        this.rerender();
      },
      onDelete: async () => {
        await this.removeAnn(ann, source);
      }
    }).open();
  }

  async removeAnn(ann, source) {
    const items = (this.store.get(source) || []).filter((x) => x.id !== ann.id);
    this.store.set(source, items);
    await this.writeStore(source, items);
    this.rerender();
    this.refreshView();
    new obsidian.Notice("已删除批注");
  }

  /* ---------- 迁移（笔记移动/改名时批注跟着走） ---------- */

  async migrateStore(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return;
    const items = this.store.get(oldPath) || (await this.readStore(oldPath));
    if (!items || !items.length) return;
    const exist = await this.readStore(newPath);
    const merged = exist.slice();
    for (const a of items) if (!merged.some((b) => b.id === a.id)) merged.push(a);
    await this.writeStore(newPath, merged);
    const oldFile = this.app.vault.getAbstractFileByPath(this.pathFor(oldPath));
    if (oldFile instanceof obsidian.TFile) {
      try {
        await this.app.vault.delete(oldFile);
      } catch (e) { /* ignore */ }
    }
    this.store.delete(oldPath);
    this.store.set(newPath, merged);
    new obsidian.Notice("批注已随笔记迁移");
  }

  /* ---------- 导出 ---------- */

  async collectAnnotated(sourcePath) {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof obsidian.TFile)) return [];
    const text = await this.app.vault.read(file);
    const items = this.store.get(sourcePath) || (await this.prime(sourcePath)) || [];
    const out = [];
    for (const a of items) {
      const idx = findMatch(text, a.text, a.prefix || "", a.suffix || "");
      let section = "";
      if (idx >= 0) {
        const before = text.slice(0, idx).split("\n");
        for (let k = before.length - 1; k >= 0; k--) {
          if (/^#{1,6}\s/.test(before[k])) {
            section = before[k].replace(/^#+\s*/, "").trim();
            break;
          }
        }
      }
      out.push({ ann: a, idx: idx < 0 ? Number.MAX_SAFE_INTEGER : idx, section });
    }
    out.sort((x, y) => x.idx - y.idx);
    return out;
  }

  async exportAnnotationsMarkdown() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return new obsidian.Notice("先打开一篇笔记");
    const rows = await this.collectAnnotated(file.path);
    if (!rows.length) return new obsidian.Notice("这篇笔记还没有批注");

    const lines = [
      "---",
      'tags: ["类型/剪藏"]',
      '来源: "[[' + file.basename + ']]"',
      '导出时间: "' + new Date().toLocaleString() + '"',
      "---",
      "",
      "# " + file.basename + " · 批注摘录",
      ""
    ];
    let lastSec = null;
    for (const r of rows) {
      if (r.section && r.section !== lastSec) {
        lastSec = r.section;
        lines.push("## " + r.section, "");
      }
      lines.push("> " + String(r.ann.text).replace(/\n/g, " "), "", r.ann.note, "");
    }

    const parentPath = file.parent && file.parent.path && file.parent.path !== "/" ? file.parent.path : "";
    const base = (parentPath ? parentPath + "/" : "") + file.basename + " - 批注摘录.md";
    let target = base;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(target)) {
      target = base.replace(/\.md$/, " (" + n + ").md");
      n++;
    }
    await this.app.vault.create(target, lines.join("\n"));
    new obsidian.Notice("已导出 " + rows.length + " 条批注：" + target);
    const nf = this.app.vault.getAbstractFileByPath(target);
    if (nf) await this.app.workspace.getLeaf(true).openFile(nf);
  }

  buildAnnotationsHtml(title, sourceName, rows) {
    const esc = htmlEscape;
    const p = [];
    p.push('<section style="font-size:16px;line-height:1.8;color:#3f3f3f;letter-spacing:.4px;">');
    p.push('<h1 style="font-size:20px;font-weight:700;margin:0 0 6px;line-height:1.4;">' + esc(title) + "</h1>");
    p.push('<p style="font-size:13px;color:#9a9a9a;margin:0 0 20px;">摘录自《' + esc(sourceName) + "》</p>");
    let lastSec = null;
    for (const r of rows) {
      if (r.section && r.section !== lastSec) {
        lastSec = r.section;
        p.push('<h2 style="font-size:17px;font-weight:700;margin:26px 0 12px;padding-left:9px;border-left:4px solid #57606a;line-height:1.45;">' + esc(r.section) + "</h2>");
      }
      p.push('<section style="margin:0 0 20px;">');
      p.push('<blockquote style="margin:0 0 8px;padding:9px 12px;border-left:3px solid #d0d7de;background:#f6f8fa;color:#57606a;font-size:14px;line-height:1.7;">' + esc(r.ann.text) + "</blockquote>");
      p.push('<p style="margin:0;font-size:15px;line-height:1.85;">' + esc(r.ann.note).replace(/\n/g, "<br>") + "</p>");
      p.push("</section>");
    }
    p.push("</section>");
    return p.join("");
  }

  async buildFullHtml(file, md, title) {
    let body = md.replace(/^---[\s\S]*?---\r?\n/, "");
    body = body.replace(/[ \t]*\^p[0-9A-Za-z\-]+/g, "");
    const div = document.createElement("div");
    try {
      await obsidian.MarkdownRenderer.renderMarkdown(body, div, file.path, this);
    } catch (e) {
      console.error("[批注边栏] 渲染 Markdown 失败，退化为纯文本", e);
      div.textContent = body;
    }
    styleForWechat(div);
    return '<section style="font-size:16px;line-height:1.85;color:#3f3f3f;letter-spacing:.4px;">' + div.innerHTML + "</section>";
  }

  async exportWechat(scope) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return new obsidian.Notice("先打开一篇笔记");
    try {
      if (scope === "annotations") {
        const rows = await this.collectAnnotated(file.path);
        if (!rows.length) return new obsidian.Notice("这篇笔记还没有批注");
        const html = this.buildAnnotationsHtml(file.basename + " · 批注摘录", file.basename, rows);
        new HtmlPreviewModal(this.app, "批注摘录", html).open();
      } else {
        const md = await this.app.vault.read(file);
        const html = await this.buildFullHtml(file, md, file.basename);
        new HtmlPreviewModal(this.app, "全文", html).open();
      }
    } catch (e) {
      console.error("[批注边栏] 导出失败", e);
      new obsidian.Notice("导出失败：" + (e && e.message ? e.message : e));
    }
  }

  async exportPdf() {
    const cmds = (this.app.commands && this.app.commands.commands) || {};
    const id = Object.keys(cmds).find((k) => {
      const n = String((cmds[k] && cmds[k].name) || "");
      return /pdf/i.test(n) && /(export|导出)/i.test(n);
    });
    if (id) {
      try {
        this.app.commands.executeCommandById(id);
        new obsidian.Notice("已调用「" + cmds[id].name + "」");
        return;
      } catch (e) {
        console.error(e);
      }
    }
    new obsidian.Notice("没有找到系统 PDF 导出命令。请用命令面板搜「Export to PDF / 导出为 PDF」，或先导出 Markdown 再转 PDF。");
  }

  /* ---------- 交互 ---------- */

  onDocClick(ev) {
    const t = ev.target;
    if (!t || !t.closest) return;
    const mark = t.closest(".am-mark");
    if (!mark) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = mark.getAttribute("data-am-id");
    this.hidePopover();
    this.activateView(id);
  }

  onHover(ev) {
    if (!this.settings.hoverPreview) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest(".am-popover")) {
      this.cancelHide();
      return;
    }
    const mark = t.closest(".am-mark");
    if (!mark) return;
    this.cancelHide();
    this.showPopover(mark);
  }

  onLeave(ev) {
    const t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest(".am-mark")) this.scheduleHide();
  }

  cancelHide() {
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  scheduleHide() {
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => this.hidePopover(), 260);
  }

  annById(mark) {
    const id = mark.getAttribute("data-am-id");
    const src = mark.getAttribute("data-am-src");
    const items = this.store.get(src) || [];
    return { ann: items.find((x) => x.id === id), src };
  }

  showPopover(mark) {
    const { ann, src } = this.annById(mark);
    if (!ann) return;
    this.hidePopover();

    const pop = document.createElement("div");
    pop.className = "am-popover";
    pop.setAttribute("data-x", "1");

    const head = document.createElement("div");
    head.className = "am-pop-head";
    const title = document.createElement("span");
    title.textContent = "批注";
    head.appendChild(title);
    const close = document.createElement("button");
    close.className = "am-pop-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.onclick = (e) => {
      e.stopPropagation();
      this.hidePopover();
    };
    head.appendChild(close);

    const bodyEl = document.createElement("div");
    bodyEl.className = "am-pop-body";
    bodyEl.textContent = ann.note;

    const foot = document.createElement("div");
    foot.className = "am-pop-foot";
    const go = document.createElement("button");
    go.textContent = "在边栏查看";
    go.onclick = (e) => {
      e.stopPropagation();
      this.hidePopover();
      this.activateView(ann.id);
    };
    const ed = document.createElement("button");
    ed.textContent = "编辑";
    ed.onclick = (e) => {
      e.stopPropagation();
      this.hidePopover();
      this.editAnn(ann, src);
    };
    foot.appendChild(go);
    foot.appendChild(ed);

    pop.appendChild(head);
    pop.appendChild(bodyEl);
    pop.appendChild(foot);

    pop.addEventListener("mouseenter", () => this.cancelHide());
    pop.addEventListener("mouseleave", () => this.scheduleHide());

    document.body.appendChild(pop);
    this.popover = pop;

    const r = mark.getBoundingClientRect();
    const pw = pop.offsetWidth || 340;
    const ph = pop.offsetHeight || 140;
    let left = Math.min(Math.max(12, r.left), window.innerWidth - pw - 12);
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 8);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  hidePopover() {
    this.cancelHide();
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
  }

  /* ---------- 视图 ---------- */

  async activateView(highlightId, draft) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        new obsidian.Notice("无法打开右侧边栏");
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (!view) return;
    if (draft && view.compose) view.compose(draft);
    else if (highlightId && view.focus) view.focus(highlightId);
  }

  refreshView() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && leaf.view.render) leaf.view.render();
    }
  }

  locate(id) {
    const mv = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (!mv) return;
    const el = mv.containerEl.querySelector('.am-mark[data-am-id="' + id + '"]');
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("am-flash");
      window.setTimeout(() => el.classList.remove("am-flash"), 1200);
    } else {
      new obsidian.Notice("当前视图里没找到这处标记，切换到阅读视图试试");
    }
  }
}

module.exports = AnnotationMarginPlugin;
module.exports.__test = { findMatch, contextOf, hash32, newId };
