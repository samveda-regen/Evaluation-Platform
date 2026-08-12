// Builds a per-candidate Safe Exam Browser (.seb) config document. SEB fetches
// this directly (via the sebs:// handoff from CandidateLogin) and launches
// straight into the given startUrl in locked-down kiosk mode.
//
// Camera/mic and prohibitedProcesses key names are best-effort based on
// commonly documented SEB config keys, not verified against every SEB
// version — see talentstaq-exam.seb at the repo root for the manually
// tested baseline this mirrors.

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSebConfigXml(startUrl: string): string {
  const parsed = new URL(startUrl);
  const hostPattern = escapeForRegex(parsed.hostname);
  const escapedStartUrl = xmlEscape(startUrl);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>

  <key>startURL</key>
  <string>${escapedStartUrl}</string>

  <key>browserViewMode</key>
  <integer>1</integer>
  <key>allowBrowsingBackForward</key>
  <false/>
  <key>browserWindowAllowReload</key>
  <false/>
  <key>showReloadWarning</key>
  <true/>
  <key>newBrowserWindowByLinkPolicy</key>
  <integer>1</integer>
  <key>newBrowserWindowByScriptPolicy</key>
  <integer>1</integer>
  <key>enableBrowserWindowToolbar</key>
  <false/>
  <key>hideBrowserWindowToolbar</key>
  <true/>
  <key>showMenuBar</key>
  <false/>
  <key>showTaskBar</key>
  <true/>
  <key>showTime</key>
  <true/>
  <key>allowedDisplaysMaxNumber</key>
  <integer>1</integer>

  <key>allowQuit</key>
  <true/>
  <key>quitURLConfirm</key>
  <true/>
  <key>hashedQuitPassword</key>
  <string></string>

  <key>URLFilterEnable</key>
  <true/>
  <key>URLFilterEnableContentFilter</key>
  <true/>
  <key>urlFilterRules</key>
  <array>
    <dict>
      <key>action</key>
      <integer>1</integer>
      <key>active</key>
      <true/>
      <key>regex</key>
      <true/>
      <key>expression</key>
      <string>^https://${hostPattern}(/.*)?$</string>
    </dict>
    <dict>
      <key>action</key>
      <integer>1</integer>
      <key>active</key>
      <true/>
      <key>regex</key>
      <true/>
      <key>expression</key>
      <string>^wss://${hostPattern}(/.*)?$</string>
    </dict>
  </array>

  <key>allowAudioCapture</key>
  <true/>
  <key>allowVideoCapture</key>
  <true/>

  <key>allowVirtualMachine</key>
  <false/>
  <key>allowScreenSharing</key>
  <false/>
  <key>allowSiri</key>
  <false/>
  <key>allowDictation</key>
  <false/>
  <key>allowSpellCheck</key>
  <false/>
  <key>allowDictionaryLookup</key>
  <false/>
  <key>allowWLAN</key>
  <false/>
  <key>enableAppSwitcherCheck</key>
  <true/>

  <key>prohibitedProcesses</key>
  <array>
    <dict>
      <key>active</key><true/>
      <key>currentUser</key><true/>
      <key>strongKill</key><true/>
      <key>description</key><string>TeamViewer</string>
      <key>executable</key><string>TeamViewer.exe</string>
      <key>os</key><integer>1</integer>
    </dict>
    <dict>
      <key>active</key><true/>
      <key>currentUser</key><true/>
      <key>strongKill</key><true/>
      <key>description</key><string>AnyDesk</string>
      <key>executable</key><string>AnyDesk.exe</string>
      <key>os</key><integer>1</integer>
    </dict>
    <dict>
      <key>active</key><true/>
      <key>currentUser</key><true/>
      <key>strongKill</key><true/>
      <key>description</key><string>OBS Studio</string>
      <key>executable</key><string>obs64.exe</string>
      <key>os</key><integer>1</integer>
    </dict>
    <dict>
      <key>active</key><true/>
      <key>currentUser</key><true/>
      <key>strongKill</key><true/>
      <key>description</key><string>Discord (screen share)</string>
      <key>executable</key><string>Discord.exe</string>
      <key>os</key><integer>1</integer>
    </dict>
  </array>

  <key>examSessionClearCookiesOnStart</key>
  <true/>
  <key>examSessionClearCookiesOnEnd</key>
  <false/>
  <key>enableLogging</key>
  <true/>
  <key>sebConfigPurpose</key>
  <integer>0</integer>

  <key>hashedAdminPassword</key>
  <string></string>

  <key>originatorVersion</key>
  <string>SEB_Win_3.6.0</string>

</dict>
</plist>
`;
}
