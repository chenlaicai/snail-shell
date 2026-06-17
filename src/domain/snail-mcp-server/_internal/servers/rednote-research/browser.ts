/**
 * Playwright 浏览器生命周期管理。
 *
 * 每次请求启动/销毁（方案 B），使用 persistent context 保持 session。
 * 默认使用系统临时目录下的稳定浏览器 profile，跨进程保留 session。
 */

import { chromium, type BrowserContext, type Page } from "playwright-core";
import path from "path";
import os from "os";
import fs from "fs";

const DEFAULT_TIMEOUT = 30_000;
const CLEANUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const TEMP_PROFILE_PREFIX = "snail-rednote-";
const DEFAULT_USER_DATA_DIR = path.join(os.tmpdir(), `${TEMP_PROFILE_PREFIX}browser-profile`);

/** 浏览器配置 */
export interface BrowserConfig {
  /** 用户数据目录（默认：系统临时目录下稳定目录，跨进程保留 session） */
  userDataDir?: string;
  /** Chrome 可执行路径（默认：自动查找或 CHROME_PATH 环境变量） */
  chromePath?: string;
}

/**
 * 获取或创建浏览器用户数据目录。
 * 优先使用配置的路径，否则创建稳定临时目录。
 */
function getOrCreateUserDataDir(config?: BrowserConfig): string {
  if (config?.userDataDir) {
    fs.mkdirSync(config.userDataDir, { recursive: true });
    return config.userDataDir;
  }

  fs.mkdirSync(DEFAULT_USER_DATA_DIR, { recursive: true });
  return DEFAULT_USER_DATA_DIR;
}

/**
 * 清理过期的浏览器临时目录。
 * 扫描 /tmp/snail-rednote-* 目录，删除超过 30 天且不是当前默认 profile 的目录。
 */
export function cleanupStaleBrowserProfiles(): void {
  const tmpBase = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpBase);
    for (const entry of entries) {
      if (!entry.startsWith(TEMP_PROFILE_PREFIX)) continue;
      const fullPath = path.join(tmpBase, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) continue;
        if (fullPath === DEFAULT_USER_DATA_DIR) continue;
        if (Date.now() - stat.mtimeMs > CLEANUP_MAX_AGE_MS) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      } catch {
        // 忽略单个目录的清理错误
      }
    }
  } catch {
    // 忽略扫描错误
  }
}

/**
 * 查找本地 Chrome/Chromium 可执行路径。
 * macOS / Linux / Windows 常见路径依次尝试。
 */
function findChromePath(): string {
  const candidates = [
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "未找到 Chrome/Chromium。请安装 Google Chrome 或设置 CHROME_PATH 环境变量。",
  );
}

function getChromeExecutablePath(config?: BrowserConfig): string {
  return config?.chromePath || process.env.CHROME_PATH || findChromePath();
}

/**
 * 启动浏览器上下文（headed 模式用于登录，headless 模式用于搜索）。
 *
 * Chromium 不允许两个进程同时使用同一 user data directory。
 * 通过互斥锁保证同一时间只有一个 context 存活。
 * 锁在 context.close() 后释放（通过 context.on("close") 事件）。
 *
 * 调用方必须在 context 使用完毕后调用 context.close()，
 * 否则后续调用将永久阻塞。
 */
let mutex: Promise<void> = Promise.resolve();

export async function launchContext(headless: boolean, config?: BrowserConfig): Promise<BrowserContext> {
  const prev = mutex;
  let release!: () => void;
  let released = false;
  mutex = new Promise<void>((r) => { release = r; });
  await prev;

  const doRelease = () => {
    if (!released) {
      released = true;
      release();
    }
  };

  const userDataDir = getOrCreateUserDataDir(config);
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      executablePath: getChromeExecutablePath(config),
      viewport: { width: 1280, height: 800 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      args: ["--disable-blink-features=AutomationControlled"],
    });
    // context 关闭时释放锁，确保下一个调用者不会冲突
    context.on("close", doRelease);
    return context;
  } catch (err) {
    doRelease();
    throw err;
  }
}

/**
 * 创建新页面并设置超时。
 */
export async function newPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  return page;
}

/**
 * 检查当前 session 是否已登录。
 * 访问 explore 页面，检测登录元素。
 */
export async function checkLoginStatus(config?: BrowserConfig): Promise<boolean> {
  let context: BrowserContext | null = null;
  try {
    context = await launchContext(true, config);
    const page = await newPage(context);
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // 多信号检测：cookie + __INITIAL_STATE__，不依赖脆弱的 DOM 选择器
    const cookies = await context.cookies("https://www.xiaohongshu.com");
    const hasSessionCookie = cookies.some(
      (c) => c.name === "customer-sso-sid" || c.name === "access-token-web",
    );
    if (!hasSessionCookie) return false;

    const hasUser = await page
      .evaluate(() => {
        const state = (globalThis as any).__INITIAL_STATE__;
        return !!state?.user?.userPageData?.basicInfo?.nickname;
      })
      .catch(() => false);
    return !!hasUser;
  } finally {
    await context?.close();
  }
}

/**
 * 打开登录页面，等待用户扫码。
 * 使用 headed 模式让用户看到二维码。
 * 返回是否登录成功。
 */
export async function waitForLogin(timeoutMs = 120_000, config?: BrowserConfig): Promise<boolean> {
  const context = await launchContext(false, config); // headed
  try {
    const page = await newPage(context);
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const isLoggedIn = await page
        .locator(".main-container .user .link-wrapper .channel")
        .count()
        .then((c) => c > 0)
        .catch(() => false);
      if (isLoggedIn) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  } finally {
    await context.close();
  }
}
