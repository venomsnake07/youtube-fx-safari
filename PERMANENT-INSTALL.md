# Keep YouTube FX installed in Safari

This package includes **v1.5.0** with linked sample-rate control, independent speed/pitch, and +/− buttons, plus the personal-use Mac app build and installer. The signed app is installed in **your Home folder → Applications → YouTube FX.app**, so Safari can load its extension after quitting and reopening. Keep that app installed; it does not need to remain running.

**This download contains source and an installer, not an already signed Mac app.** The final build and Apple signing happen on your own Mac. A native build and Safari restart check could not be performed in this Linux workspace.

## One-time setup

1. Install **[Xcode from Apple](https://apps.apple.com/app/xcode/id497799835)**. Open it once and finish its first-run setup. The smaller Command Line Tools download is insufficient.
2. In **Xcode → Settings → Accounts** (called **Apple Accounts** in some releases), sign in with your Apple Account. Select your team / Personal Team.
3. Click **Manage Certificates… → + → Apple Development**. If a valid Apple Development certificate with a private key is already on this Mac, use it.

Apple provides local development with a free Apple Account. This is a personal development build, not App Store distribution. The certificate and any applicable provisioning remain subject to Apple's validity limits. Do not buy a Developer Program membership just to try this local build. If Xcode cannot create the certificate, keep its exact error message.

## Install

1. Extract **the entire ZIP** into one folder. Do not add this ZIP using Safari's Add Temporary Extension button.
2. Double-click **INSTALL-ON-MAC.command**. It checks Xcode and your signing identity, verifies the bundled extension files, uses Apple's packager to create the Mac app, builds it, signs both the extension and its host app, then installs and opens the verified app. If several development certificates exist, choose yours from the list.
3. If macOS prevents opening the downloaded command file, review it in a text editor. Use Finder's **Control-click → Open** where offered, or **System Settings → Privacy & Security → Open Anyway** for this file if macOS offers that action. Do not disable Gatekeeper. As an alternative, in Terminal type `/bin/bash `, drag **INSTALL-ON-MAC.command** into the window, then press Return.
4. After the app has built successfully, turn effects off in the old extension and remove its **Temporary** entry in **Safari → Settings → Extensions**. Enable the newly installed **YouTube FX** entry and allow **youtube.com**, plus **music.youtube.com** if needed. Enable it for your Safari profile as well if you use profiles.
5. **Reload every YouTube tab.** The temporary and signed installations use separate extension storage, so you may need to set your sliders again. Your previous diagnostic used **−1 semitone, 62% reverb, 4.8-second decay**.
6. **Quit Safari completely with ⌘Q, then reopen it.** Confirm YouTube FX stays enabled and works with **Allow unsigned extensions turned off**. Its panel should still say **v1.5.0**.

You can close Xcode and the YouTube FX app after installation. No login item, automatic reinstaller, administrator install, or change to Safari's security settings is used. A normal macOS Keychain prompt may ask permission for `codesign` to use your development signing key; the installer does not collect passwords or export keys.

## What “permanent” means here

The app and extension stay installed across Safari restarts and are not temporary 24-hour loads. An Apple development signature is **not a lifetime guarantee**: the certificate, any applicable profile, or trust status can expire or be revoked. If the installed copy later stops loading, create or renew your development certificate in Xcode and run the installer again. It checks for a currently valid signing identity each time.

For a normal downloadable release for other people, use an **App Store release** or a **Developer ID–signed and notarized Mac app**. Those distribution routes require the Apple Developer Program and Apple signing/review steps. This source ZIP does not pretend to be such a release.

## If the build fails

- **Xcode missing:** install the full app, open it, and finish its setup. The installer can use `/Applications/Xcode.app` without changing the system's selected developer tools.
- **No signing identity:** follow the certificate steps above. “Sign to Run Locally”, ad hoc signatures, self-signed certificates, distribution-only certificates, and certificates without a private key are not accepted by this installer.
- **Keychain signing error:** check Xcode → Accounts → Manage Certificates. Make sure the Apple Development certificate is valid and its private key is available in your login Keychain. Keep the normal macOS error text for troubleshooting.
- **Packager/build error:** the installer prints the exact log location. It supports the current `safari-web-extension-packager` name and the older `safari-web-extension-converter` name. The full generated Xcode project remains in the printed build folder for inspection or manual building.
- **Signed extension not visible:** open **Home → Applications → YouTube FX.app** at least once, then use its Safari settings button. Check Safari → Settings → Extensions and your profile's Extensions tab. Quit/reopen Safari after removing the old temporary entry.
- **Works only with Allow unsigned extensions:** the signed installation has not been verified successfully. Do not treat it as a completed permanent installation; keep the build/signature log and the Safari behavior for troubleshooting.

The installer does not replace an unrelated app with the same name. Before updating an existing matching YouTube FX.app, it verifies the new copy and moves the previous app to the printed backup folder. Build logs remain locally under `~/Library/Caches/YouTubeFX/`.

To remove the installed version, disable it in Safari, move **Home → Applications → YouTube FX.app** to the Trash, and reload YouTube. The source download and build caches are not required for normal playback.

## Apple references

- [Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
- [Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)
- [Create signing certificates in Xcode](https://help.apple.com/xcode/mac/current/en.lproj/dev154b28f09.html)
- [Apple developer program options](https://developer.apple.com/help/account/membership/programs-overview/)
- [Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
