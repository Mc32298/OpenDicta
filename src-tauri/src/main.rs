// This file is the entry point for the Tauri app.
// Tauri requires that main.rs be kept minimal — all logic lives in lib.rs.
// The #![cfg_attr] line prevents a console window from opening on Windows.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    opendicta_lib::run();
}
