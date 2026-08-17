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

export function buildSebConfigXml(startUrl: string): string {
  const escapedStartUrl = xmlEscape(startUrl);
  // Same origin as startUrl, not hardcoded, so this stays correct across environments
  // (staging/production) this config might be generated for. TestComplete.tsx's "Close"
  // button navigates here — real navigation, not client-side routing — for SEB to detect
  // and quit instead of loading the page. Needs verification on a real exam session that
  // the quit link actually fires before this depends on it in production.
  const quitUrl = `${new URL(startUrl).origin}/test/seb-quit`;
  const escapedQuitUrl = xmlEscape(quitUrl);

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
  <!-- seb.log showed SEB's own ActionCenter overlay popping in/out
       automatically throughout a session, unrelated to anything the
       candidate did. That's plausibly occluding the browser content area
       and triggering Chromium's occlusion-based Page Visibility API,
       which is what fired false "tab_switch" violations. Candidates
       taking a locked-down exam don't need system-tray access anyway. -->
  <key>showTaskBar</key>
  <false/>
  <key>showTime</key>
  <true/>
  <key>allowedDisplaysMaxNumber</key>
  <integer>1</integer>

  <key>allowQuit</key>
  <true/>
  <key>quitURL</key>
  <string>${escapedQuitUrl}</string>
  <key>quitURLConfirm</key>
  <true/>
  <key>hashedQuitPassword</key>
  <string></string>

  <!-- seb.log (3 separate live tests) showed the auto-generated start-URL
       rule matches the START URL ONLY, not the whole domain despite what
       the manual claims — with URLFilterEnableContentFilter on, every
       sub-resource that isn't a byte-for-byte match (the app's own JS
       bundle, CSS, favicon) gets blocked, producing a blank page. Content
       filtering off; URLFilterEnable stays on to still block top-level
       navigation away from the site. -->
  <key>URLFilterEnable</key>
  <true/>
  <key>URLFilterEnableContentFilter</key>
  <false/>

  <key>allowAudioCapture</key>
  <true/>
  <key>allowVideoCapture</key>
  <true/>

  <key>allowVirtualMachine</key>
  <false/>
  <!-- The app's own violation-evidence capture (useProctoring.ts's
       captureViolationEvidenceFrame) prefers a getDisplayMedia() screen
       frame over the webcam when reporting a violation. Blocking screen
       sharing here silently killed that, leaving violations logged with
       no evidence image. Actual screen-sharing/remote-access SOFTWARE
       (TeamViewer, AnyDesk, Discord, etc.) is already blocked below via
       prohibitedProcesses, so this flag was mostly just breaking our own
       feature rather than adding real security. -->
  <key>allowScreenSharing</key>
  <true/>
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
