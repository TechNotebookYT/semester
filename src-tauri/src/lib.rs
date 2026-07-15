/// Fire a Force Touch trackpad haptic (macOS only; no-op elsewhere).
/// `pattern`: "strong" (level change), "generic", or default alignment tick.
#[tauri::command]
fn haptic(app: tauri::AppHandle, pattern: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || {
            use objc2_app_kit::{
                NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
                NSHapticFeedbackPerformer,
            };
            let p = match pattern.as_deref() {
                Some("strong") => NSHapticFeedbackPattern::LevelChange,
                Some("generic") => NSHapticFeedbackPattern::Generic,
                _ => NSHapticFeedbackPattern::Alignment,
            };
            let performer = NSHapticFeedbackManager::defaultPerformer();
            performer.performFeedbackPattern_performanceTime(p, NSHapticFeedbackPerformanceTime::Now);
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, pattern);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![haptic])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
