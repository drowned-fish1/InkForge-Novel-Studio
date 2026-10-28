const electronMock = `
import path from "node:path";

const handlers = new Map();
const listeners = new Map();
const sentMessages = [];

export const app = {
  isPackaged: false,
  getVersion: () => "0.0.0-smoke",
  getPath: name => name === "userData"
    ? process.env.INKFORGE_SMOKE_USER_DATA || path.join(process.cwd(), "output", "smoke-user-data")
    : process.cwd(),
  whenReady: async () => undefined,
  quit: () => undefined,
  on: (channel, listener) => listeners.set(channel, listener)
};

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from("encrypted:" + value, "utf8"),
  decryptString: value => Buffer.from(value).toString("utf8").replace(/^encrypted:/u, "")
};

export const dialog = {
  showOpenDialog: async () => process.env.INKFORGE_SMOKE_OPEN_DIALOG_PATH
    ? ({ canceled: false, filePaths: [process.env.INKFORGE_SMOKE_OPEN_DIALOG_PATH] })
    : ({ canceled: true, filePaths: [] }),
  showSaveDialog: async options => ({ canceled: false, filePath: options.defaultPath })
};

export const nativeTheme = {
  shouldUseDarkColors: false,
  on: () => undefined
};

export const shell = {
  openPath: async () => "",
  openExternal: async () => undefined
};

export const session = {
  defaultSession: {
    setPermissionRequestHandler: () => undefined
  }
};

export const ipcMain = {
  on: (channel, listener) => listeners.set(channel, listener),
  handle: (channel, handler) => handlers.set(channel, handler)
};

export class BrowserWindow {
  static getAllWindows() {
    return [];
  }
  constructor() {
    this.webContents = { openDevTools: () => undefined };
  }
  setBackgroundColor() {}
  async loadURL() {}
  async loadFile() {}
}

export const __electronMock = {
  handlers,
  listeners,
  sentMessages,
  async invoke(channel, ...args) {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error("No IPC handler registered for " + channel);
    }
    return handler({ sender: { send: (...message) => sentMessages.push(message) } }, ...args);
  },
  send(channel, ...args) {
    const listener = listeners.get(channel);
    if (!listener) {
      throw new Error("No IPC listener registered for " + channel);
    }
    return listener({}, ...args);
  }
};
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return {
      url: `data:text/javascript,${encodeURIComponent(electronMock)}`,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
