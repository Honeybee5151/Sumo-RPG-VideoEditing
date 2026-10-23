import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const GITHUB_REPO = 'Honeybee5151/Sumo-RPG-VideoEditing';
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

function normalizeVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .trim()
    .split(/[.-]/)
    .map((n) => parseInt(n, 10) || 0);
}

function isNewerVersion(remoteVer: string, localVer: string): boolean {
  const r = normalizeVersion(remoteVer);
  const l = normalizeVersion(localVer);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

function getLocalVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || '0.0.1';
  } catch {
    return '0.0.1';
  }
}

export async function GET() {
  const currentVersion = getLocalVersion();
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Sumo-VideoEditor-AutoUpdater',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: true,
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
      });
    }

    const release = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      body?: string;
      published_at?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };

    const latestVersion = (release.tag_name || currentVersion).replace(/^v/i, '');
    const updateAvailable = isNewerVersion(latestVersion, currentVersion);
    const installerAsset = release.assets?.find((a) =>
      /\.(exe|msi|zip)$/i.test(a.name)
    );

    return NextResponse.json({
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseName: release.name || `v${latestVersion}`,
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      downloadUrl: installerAsset?.browser_download_url || null,
      publishedAt: release.published_at || null,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    });
  }
}

export async function POST() {
  const currentVersion = getLocalVersion();
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Sumo-VideoEditor-AutoUpdater',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        updated: false,
        currentVersion,
        message: 'No published release found on GitHub.',
      });
    }

    const release = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
    };
    const latestTag = release.tag_name || `v${currentVersion}`;
    const latestVersion = latestTag.replace(/^v/i, '');

    if (!isNewerVersion(latestVersion, currentVersion)) {
      return NextResponse.json({
        ok: true,
        updated: false,
        currentVersion,
        latestVersion,
        message: 'Sumo VideoEditor is already on the latest release.',
      });
    }

    // Pull latest release commits from origin/main
    await execAsync('git fetch origin --tags && git pull --ff-only origin main', {
      cwd: process.cwd(),
    });

    return NextResponse.json({
      ok: true,
      updated: true,
      previousVersion: currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      message: `Updated Sumo VideoEditor to release v${latestVersion}.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        updated: false,
        currentVersion,
        error: err instanceof Error ? err.message : 'Auto-update failed.',
      },
      { status: 500 }
    );
  }
}
