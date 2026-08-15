fn main() {
    println!("cargo:rerun-if-env-changed=CS2_LIBUNWIND_DLL");
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnullvm") {
        let source = std::env::var_os("CS2_LIBUNWIND_DLL")
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_file())
            .expect("gnullvm builds require CS2_LIBUNWIND_DLL to point to libunwind.dll");
        let out_dir = std::path::PathBuf::from(
            std::env::var_os("OUT_DIR").expect("Cargo did not provide OUT_DIR"),
        );
        let release_dir = out_dir
            .ancestors()
            .nth(3)
            .expect("unable to resolve Cargo profile directory from OUT_DIR");
        std::fs::copy(&source, release_dir.join("libunwind.dll"))
            .expect("failed to stage libunwind.dll beside the Tauri executable");
    }

    tauri_build::build();

    // `tauri-build` embeds Common Controls v6 into application binaries, but
    // Cargo's generated Rust test executable is a separate target. Without the
    // same manifest Windows loads comctl32 v5 and fails before the test harness
    // starts because TaskDialogIndirect is unavailable.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var_os("CARGO_FEATURE_RUST_TEST_MANIFEST").is_some()
    {
        embed_resource::compile_for_everything("windows/test-manifest.rc", embed_resource::NONE)
            .manifest_required()
            .expect("failed to embed the Windows test manifest");
    }
}
