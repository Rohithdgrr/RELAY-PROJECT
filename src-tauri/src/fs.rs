//! F3 / F5 — project directory access and the file read/write bridge.
//!
//! Enforces the security rules from Complete Docs §8.4: read-only patterns
//! (`.env*`, `node_modules`, keys), size caps, backups before overwrite, and
//! atomic writes.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Patterns that are never writable (Complete Docs §8.4 / PRD §11.3).
const READ_ONLY_PATTERNS: &[&str] = &[".env", ".env.*", "node_modules", "*.pem", "*.key"];
/// Directories skipped when listing the project tree (Complete Docs §10.2B).
const EXCLUDE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".next",
    "__pycache__",
    "coverage",
    ".relay-backup",
];
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024; // config: max_file_size_mb = 5

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

fn is_read_only(path: &str) -> bool {
    let p = Path::new(path);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let rel = p.to_string_lossy().to_lowercase();
    READ_ONLY_PATTERNS.iter().any(|pat| {
        if *pat == "node_modules" {
            rel.contains("node_modules")
        } else if let Some(prefix) = pat.strip_suffix(".*") {
            name.starts_with(prefix) && name.len() > prefix.len()
        } else if let Some(ext) = pat.strip_prefix("*.") {
            name.ends_with(ext)
        } else {
            name == *pat
        }
    })
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = PathBuf::from(&path);
    let mut entries: Vec<DirEntry> = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| format!("cannot read {path}: {e}"))?;
    for entry in rd.flatten() {
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = file_type.is_dir();
        if !is_dir && !file_type.is_file() {
            continue; // symlinks/sockets: skip in v0.1
        }
        if is_dir && EXCLUDE_DIRS.contains(&name.as_str()) {
            continue;
        }
        let size = if is_dir {
            None
        } else {
            entry.metadata().ok().map(|m| m.len())
        };
        entries.push(DirEntry {
            name,
            path: entry.path().display().to_string(),
            is_dir,
            size,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "file too large ({} bytes; cap is {MAX_FILE_BYTES})",
            meta.len()
        ));
    }
    fs::read_to_string(&path).map_err(|e| format!("cannot read {path}: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if is_read_only(&path) {
        return Err(format!(
            "{path} is protected by Relay's read-only patterns (Complete Docs §8.4)"
        ));
    }
    let target = PathBuf::from(&path);

    // Backup before edit (Complete Docs §8.4: backup_before_edit = true).
    if let Some(parent) = target.parent() {
        let backup_dir = parent.join(".relay-backup");
        let _ = fs::create_dir_all(&backup_dir);
        if target.exists() {
            let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
            let backup_path = backup_dir.join(format!(
                "{}.{}",
                target
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file"),
                stamp
            ));
            let _ = fs::copy(&target, &backup_path);
        }
    }

    // Atomic write: temp file + rename, so a crash never leaves a torn file.
    let tmp = target.with_extension("relay-tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot write {path}: {e}")
    })?;
    Ok(())
}

#[tauri::command]
pub fn pick_project_dir() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Select your project folder")
        .pick_folder()
        .map(|p| p.display().to_string()))
}

/// Best-effort project metadata for Relay Packets (PRD §6.2 project_context):
/// currently parses `package.json` dependencies; Cargo.toml / requirements.txt
/// awareness is planned (Complete Docs §3.4).
pub fn project_context(
    root: &str,
) -> (Vec<String>, HashMap<String, String>, Vec<String>) {
    if root.is_empty() {
        return (vec![], HashMap::new(), vec![]);
    }
    let mut dependencies = Vec::new();
    let pkg = Path::new(root).join("package.json");
    if let Ok(text) = fs::read_to_string(&pkg) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(deps) = json["dependencies"].as_object() {
                dependencies.extend(deps.keys().cloned());
            }
            if let Some(deps) = json["devDependencies"].as_object() {
                dependencies.extend(deps.keys().cloned());
            }
        }
    }
    dependencies.sort();
    dependencies.dedup();
    (vec![], HashMap::new(), dependencies)
}
