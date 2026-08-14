fn main() {
    tauri_build::build();

    // `tauri-build` embeds Common Controls v6 into application binaries, but
    // Cargo's generated Rust test executable is a separate target. Without the
    // same manifest Windows loads comctl32 v5 and fails before the test harness
    // starts because TaskDialogIndirect is unavailable.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var_os("CARGO_FEATURE_RUST_TEST_MANIFEST").is_some()
    {
        embed_resource::compile_for_everything(
            "windows/test-manifest.rc",
            embed_resource::NONE,
        )
        .manifest_required()
        .expect("failed to embed the Windows test manifest");
    }
}
