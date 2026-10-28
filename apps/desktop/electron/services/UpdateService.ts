import { app } from "electron";
import type { UpdateStatus } from "../types.js";

type ElectronUpdater = (typeof import("electron-updater"))["autoUpdater"];

const disabledStatus = (message: string): UpdateStatus => ({
  phase: "disabled",
  configured: false,
  currentVersion: app.getVersion(),
  message
});

/**
 * Optional generic-feed updater. Public builds opt in with an HTTPS
 * INKFORGE_UPDATE_URL; unsigned/local builds remain inert and never contact a
 * network endpoint. The renderer can poll the small state machine over IPC.
 */
export class UpdateService {
  private updater?: ElectronUpdater;
  private state: UpdateStatus = disabledStatus("Automatic updates are not configured.");

  status(): UpdateStatus {
    return { ...this.state };
  }

  async configure(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.state = disabledStatus("Automatic updates are disabled in development builds.");
      return this.status();
    }
    const feedUrl = process.env.INKFORGE_UPDATE_URL?.trim();
    if (!feedUrl || !this.isSafeFeedUrl(feedUrl)) {
      this.state = disabledStatus("Set INKFORGE_UPDATE_URL to an HTTPS update feed to enable updates.");
      return this.status();
    }
    try {
      const { autoUpdater } = await import("electron-updater");
      this.updater = autoUpdater;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
      autoUpdater.on("checking-for-update", () => this.patch({ phase: "checking", message: "Checking for updates." }));
      autoUpdater.on("update-available", (info) =>
        this.patch({
          phase: "available",
          availableVersion: info.version,
          message: `Version ${info.version} is available.`
        })
      );
      autoUpdater.on("update-not-available", () =>
        this.patch({ phase: "not-available", availableVersion: undefined, message: "InkForge is up to date." })
      );
      autoUpdater.on("download-progress", (progress) =>
        this.patch({ phase: "downloading", downloadPercent: progress.percent, message: "Downloading update." })
      );
      autoUpdater.on("update-downloaded", (info) =>
        this.patch({
          phase: "downloaded",
          availableVersion: info.version,
          downloadPercent: 100,
          message: "Update downloaded and ready to install."
        })
      );
      autoUpdater.on("error", (error) => this.patch({ phase: "error", message: error.message }));
      this.state = {
        phase: "idle",
        configured: true,
        currentVersion: app.getVersion(),
        message: "Automatic update feed configured."
      };
    } catch (error) {
      this.state = {
        phase: "error",
        configured: false,
        currentVersion: app.getVersion(),
        message: error instanceof Error ? error.message : String(error)
      };
    }
    return this.status();
  }

  async check(): Promise<UpdateStatus> {
    if (!this.updater) await this.configure();
    if (!this.updater) return this.status();
    this.patch({ phase: "checking", message: "Checking for updates." });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.patch({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return this.status();
  }

  async download(): Promise<UpdateStatus> {
    if (!this.updater || this.state.phase !== "available") return this.status();
    try {
      this.patch({ phase: "downloading", downloadPercent: 0, message: "Downloading update." });
      await this.updater.downloadUpdate();
    } catch (error) {
      this.patch({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return this.status();
  }

  install(): boolean {
    if (!this.updater || this.state.phase !== "downloaded") return false;
    this.updater.quitAndInstall(false, true);
    return true;
  }

  private patch(patch: Partial<UpdateStatus>): void {
    this.state = { ...this.state, ...patch };
  }

  private isSafeFeedUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }
}
