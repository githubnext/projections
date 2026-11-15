//! The switches the browser is launched with.

use std::path::Path;

use super::Transport;

/// Chrome switches for a quiet, deterministic, offline headless browser.
pub(super) fn arguments(profile: &Path, transport: Transport, width: u32, height: u32, scale: f64) -> Vec<String> {
    vec![
        "--headless=new".to_owned(),
        format!("--user-data-dir={}", profile.display()),
        match transport {
            Transport::Pipe => "--remote-debugging-pipe".to_owned(),
            Transport::Port => "--remote-debugging-port=0".to_owned(),
        },
        format!("--window-size={width},{height}"),
        // The density of every frame. `Emulation.setDeviceMetricsOverride` sets it for the page's own frame only: an
        // out-of-process frame (Chrome isolates sandboxed frames, so every renderer's) would paint at 1 and be scaled
        // up, blurring the renderer's text in a high-density image.
        format!("--force-device-scale-factor={scale}"),
        // No first-run UI, extensions, sync, updates, telemetry or keychain prompts.
        "--no-first-run".to_owned(),
        "--no-default-browser-check".to_owned(),
        "--disable-extensions".to_owned(),
        "--disable-component-extensions-with-background-pages".to_owned(),
        "--disable-background-networking".to_owned(),
        "--disable-component-update".to_owned(),
        "--disable-default-apps".to_owned(),
        "--disable-sync".to_owned(),
        "--disable-domain-reliability".to_owned(),
        "--disable-client-side-phishing-detection".to_owned(),
        "--disable-breakpad".to_owned(),
        "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater,DialMediaRouteProvider,CalculateNativeWinOcclusion".to_owned(),
        "--metrics-recording-only".to_owned(),
        "--no-pings".to_owned(),
        "--password-store=basic".to_owned(),
        "--use-mock-keychain".to_owned(),
        "--mute-audio".to_owned(),
        // Nothing beyond loopback: no proxy, and every other host fails to resolve.
        "--no-proxy-server".to_owned(),
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1".to_owned(),
        // Timers and painting are never throttled in the background.
        "--disable-background-timer-throttling".to_owned(),
        "--disable-backgrounding-occluded-windows".to_owned(),
        "--disable-renderer-backgrounding".to_owned(),
        "--disable-hang-monitor".to_owned(),
        "--disable-ipc-flooding-protection".to_owned(),
        // The same pixels for the same input: software rendering, whole tiles
        // rasterized (a tile partly re-rasterized while the page loads antialiases
        // the edges it clips differently), sRGB, no subpixel text or font
        // hinting, no scrollbars, one locale.
        "--disable-gpu".to_owned(),
        "--disable-partial-raster".to_owned(),
        "--force-color-profile=srgb".to_owned(),
        "--font-render-hinting=none".to_owned(),
        "--disable-lcd-text".to_owned(),
        "--hide-scrollbars".to_owned(),
        "--lang=en-US".to_owned(),
        "--accept-lang=en-US".to_owned(),
        "about:blank".to_owned(),
    ]
}
