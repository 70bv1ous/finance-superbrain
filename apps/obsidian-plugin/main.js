const { Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } = require("obsidian");

function formatTimestamp(value) {
  return value.replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
}

function renderList(items, empty = "- None.") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

function truncateText(value, maxLength = 140) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildFrontmatter(settings, sync) {
  const base = [
    `managed_by: ${JSON.stringify("finance_superbrain_plugin")}`,
    `type: ${JSON.stringify("project")}`,
    `plugin_id: ${JSON.stringify("finance-superbrain")}`,
    `api_base_url: ${JSON.stringify(settings.apiBaseUrl)}`,
    `export_root: ${JSON.stringify(settings.exportRoot)}`,
  ];

  if (sync) {
    base.push(`workspace_id: ${JSON.stringify(sync.workspace_id)}`);
    base.push(`captured_at: ${JSON.stringify(sync.captured_at)}`);
    base.push(`sync_mode: ${JSON.stringify(sync.mode)}`);
    base.push(`dirty: ${JSON.stringify(sync.dirty)}`);
    base.push(`branch: ${sync.branch === null ? "null" : JSON.stringify(sync.branch)}`);
    base.push(`head: ${sync.head === null ? "null" : JSON.stringify(sync.head)}`);
  }

  return `---\n${base.join("\n")}\n---`;
}

function buildStatusMarkdown(settings, sync, review, error) {
  const now = new Date().toISOString();
  const importableCandidates = review?.candidates.filter((candidate) => candidate.status === "importable") ?? [];
  const topCandidates = importableCandidates.slice(0, 10);
  const recentChanges = sync?.changed_file_paths.slice(0, 20).map((file) => file.replace(/\\/g, "/")) ?? [];

  return [
    buildFrontmatter(settings, sync),
    "# Obsidian Plugin Sync",
    "",
    "Generated project memory for automatic workspace syncing.",
    "",
    "## Current Snapshot",
    sync
      ? [
          `- Captured: ${formatTimestamp(sync.captured_at)}`,
          `- Mode: ${sync.mode}`,
          `- Workspace: ${sync.workspace_id}`,
          `- Target note: ${sync.target_path}`,
          `- Branch: ${sync.branch ?? "Not available"}`,
          `- Head: ${sync.head ?? "Not available"}`,
          `- Dirty tree: ${sync.dirty ? "yes" : "no"}`,
          `- Changed files: ${sync.changed_files}`,
        ].join("\n")
      : "- Sync has not completed yet.",
    "",
    "## Recent Changes",
    renderList(recentChanges, "- No file changes were captured."),
    "",
    "## Recent Sessions",
    sync?.recent_sessions.length
      ? renderList(
          sync.recent_sessions.map((session) => {
            const cleanliness = session.dirty ? "dirty" : "clean";
            return `${formatTimestamp(session.captured_at)} | ${session.mode} | ${cleanliness} | ${session.changed_files} files`;
          }),
        )
      : "- No session history yet.",
    "",
    "## Automation",
    [
      "- The local API records git state into `.finance-superbrain/obsidian-sync-state.json`.",
      sync?.export_note_counts
        ? `- The last full workspace export wrote ${sync.export_note_counts.total} managed notes into Obsidian.`
        : "- The last full workspace export count is not available yet.",
      "- The app-generated work-session note and this plugin note are refreshed from the same sync response.",
      "- Product memory export stays separate so raw workspace changes do not overwrite reviewed decision memory.",
    ].join("\n"),
    "",
    "## Latest Import Review",
    sync?.latest_import_review
      ? [
          `- Reviewed: ${formatTimestamp(sync.latest_import_review.reviewed_at)}`,
          `- Selected: ${sync.latest_import_review.selected}`,
          `- Rejected: ${sync.latest_import_review.rejected}`,
          `- Imported: ${sync.latest_import_review.imported}`,
          `- Skipped: ${sync.latest_import_review.skipped}`,
          `- Duplicate: ${sync.latest_import_review.duplicate}`,
        ].join("\n")
      : "- No applied import review has been recorded yet.",
    "",
    "## Import Candidates",
    review
      ? [
          `- Scanned: ${review.counts.scanned}`,
          `- Importable: ${review.counts.importable}`,
          `- Imported: ${review.counts.imported}`,
          `- Duplicate: ${review.counts.duplicate}`,
          `- Skipped: ${review.counts.skipped}`,
          `- Errors: ${review.counts.errors}`,
          `- Inbox: ${review.inbox_path}`,
        ].join("\n")
      : "- No import-candidate snapshot yet.",
    "",
    "### Importable Notes",
    renderList(
      topCandidates.map((candidate) => {
        const reason = candidate.reason ? ` | ${candidate.reason}` : "";
        const summary = candidate.summary ? ` :: ${truncateText(candidate.summary)}` : "";
        return `${candidate.title} (${candidate.relative_path})${reason}${summary}`;
      }),
      "- No importable notes were found.",
    ),
    "",
    "### Review Warnings",
    renderList(review?.warnings ?? [], "- None."),
    "",
    "## Health",
    error ? `- Last error: ${error}` : "- Last error: none",
    `- Last updated: ${formatTimestamp(now)}`,
  ].join("\n");
}

async function ensureFolder(adapter, folderPath) {
  const normalized = normalizePath(folderPath);
  if (!normalized) {
    return;
  }

  const parts = normalized.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://localhost:3001",
  exportRoot: "Finance Superbrain",
  statusNotePath: "Finance Superbrain/Project/Obsidian Plugin Sync.md",
  inboxPath: "Finance Superbrain/Human Inbox",
  syncIntervalMinutes: 5,
  syncOnStart: true,
  syncOnInboxChange: true,
};

class FinanceSuperbrainPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.syncPromise = null;
    this.syncQueued = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this.statusBarItem = null;
    this.syncIntervalHandle = null;
  }

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("sync", "Finance Superbrain sync", () => {
      void this.syncNow("manual");
    });

    this.addCommand({
      id: "finance-superbrain-sync-now",
      name: "Finance Superbrain: Sync now",
      callback: () => {
        void this.syncNow("manual");
      },
    });

    this.addCommand({
      id: "finance-superbrain-open-status-note",
      name: "Finance Superbrain: Open sync note",
      callback: async () => {
        await this.openStatusNote();
      },
    });

    this.addCommand({
      id: "finance-superbrain-refresh-review",
      name: "Finance Superbrain: Refresh import review",
      callback: () => {
        void this.syncNow("manual");
      },
    });

    this.addSettingTab(new FinanceSuperbrainSettingTab(this.app, this));

    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar();
    this.refreshSyncInterval();

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) {
          return;
        }

        if (!this.settings.syncOnInboxChange) {
          return;
        }

        if (normalizePath(file.path).startsWith(normalizePath(this.settings.inboxPath))) {
          void this.queueSync("watch");
        }
      }),
    );

    if (this.settings.syncOnStart) {
      void this.syncNow("manual");
    }
  }

  onunload() {
    this.clearSyncInterval();
    this.statusBarItem = null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshSyncInterval();
  }

  get apiBaseUrl() {
    return this.settings.apiBaseUrl.replace(/\/+$/, "");
  }

  async requestJson(path, init) {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      credentials: "omit",
      ...init,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body || `Request failed with status ${response.status}`);
    }

    return response.json();
  }

  async writeStatusNote(sync, review, error) {
    const targetPath = normalizePath(this.settings.statusNotePath);
    const folderPath = targetPath.split("/").slice(0, -1).join("/");
    await ensureFolder(this.app.vault.adapter, folderPath);
    const content = buildStatusMarkdown(this.settings, sync, review, error);

    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, `${content}\n`);
      return;
    }

    await this.app.vault.create(targetPath, `${content}\n`);
  }

  updateStatusBar() {
    if (!this.statusBarItem) {
      return;
    }

    this.statusBarItem.classList.toggle("is-error", Boolean(this.lastError));
    this.statusBarItem.setText(
      this.lastError
        ? "Finance Superbrain: error"
        : this.lastSyncAt
          ? `Finance Superbrain: ${formatTimestamp(this.lastSyncAt)}`
          : "Finance Superbrain: idle",
    );
  }

  clearSyncInterval() {
    if (this.syncIntervalHandle !== null) {
      window.clearInterval(this.syncIntervalHandle);
      this.syncIntervalHandle = null;
    }
  }

  refreshSyncInterval() {
    this.clearSyncInterval();
    this.syncIntervalHandle = window.setInterval(() => {
      void this.queueSync("watch");
    }, Math.max(1, this.settings.syncIntervalMinutes) * 60 * 1000);
  }

  async queueSync(mode) {
    if (this.syncPromise) {
      this.syncQueued = true;
      return;
    }

    this.syncPromise = this.runSync(mode).finally(() => {
      this.syncPromise = null;
      if (this.syncQueued) {
        this.syncQueued = false;
        void this.queueSync("watch");
      }
    });

    await this.syncPromise;
  }

  async syncNow(mode) {
    await this.queueSync(mode);
  }

  async runSync(mode) {
    try {
      const sync = await this.requestJson("/v1/obsidian/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const review = await this.requestJson("/v1/obsidian/import-candidates");

      await this.writeStatusNote(sync, review, null);
      this.lastSyncAt = sync.captured_at;
      this.lastError = null;
      this.updateStatusBar();

      if (mode === "manual") {
        new Notice("Finance Superbrain sync updated.");
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown sync failure.";
      this.updateStatusBar();
      try {
        await this.writeStatusNote(null, null, this.lastError);
      } catch {
        // Keep the failure visible in the status bar even if the note write fails.
      }
      new Notice(`Finance Superbrain sync failed: ${this.lastError}`);
    }
  }

  async openStatusNote() {
    const targetPath = normalizePath(this.settings.statusNotePath);
    const file = this.app.vault.getAbstractFileByPath(targetPath);

    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
      return;
    }

    new Notice("Finance Superbrain sync note has not been created yet.");
  }
}

class FinanceSuperbrainSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("Local Finance Superbrain API endpoint.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:3001")
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Export root")
      .setDesc("Managed subtree name inside the vault.")
      .addText((text) =>
        text
          .setPlaceholder("Finance Superbrain")
          .setValue(this.plugin.settings.exportRoot)
          .onChange(async (value) => {
            this.plugin.settings.exportRoot = value.trim() || DEFAULT_SETTINGS.exportRoot;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Status note path")
      .setDesc("Generated plugin status note inside the vault.")
      .addText((text) =>
        text
          .setPlaceholder("Finance Superbrain/Project/Obsidian Plugin Sync.md")
          .setValue(this.plugin.settings.statusNotePath)
          .onChange(async (value) => {
            this.plugin.settings.statusNotePath = value.trim() || DEFAULT_SETTINGS.statusNotePath;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Inbox path")
      .setDesc("Path used to detect Human Inbox changes.")
      .addText((text) =>
        text
          .setPlaceholder("Finance Superbrain/Human Inbox")
          .setValue(this.plugin.settings.inboxPath)
          .onChange(async (value) => {
            this.plugin.settings.inboxPath = value.trim() || DEFAULT_SETTINGS.inboxPath;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-sync interval")
      .setDesc("How often the plugin refreshes the sync note.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 60, 1)
          .setValue(this.plugin.settings.syncIntervalMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalMinutes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync on start")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (value) => {
          this.plugin.settings.syncOnStart = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sync on inbox change")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnInboxChange).onChange(async (value) => {
          this.plugin.settings.syncOnInboxChange = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}

module.exports = FinanceSuperbrainPlugin;
