//! F3 / F5 — project directory access and the file read/write bridge.
//!
//! Enforces the security rules from Complete Docs §8.4: read-only patterns
//! (`.env*`, `node_modules`, keys), size caps, backups before overwrite, and
//! atomic writes.
//!
//! All filesystem work runs off the main thread (`spawn_blocking`) so the UI
//! never freezes — including the native folder dialog, which previously ran
//! on the main thread and could hang the window.

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

#[derive(Serialize)]
pub struct GitStatusEntry {
    /// Repository-relative path (forward slashes), as reported by git.
    pub path: String,
    /// Porcelain code, e.g. "??", " M", "A ", "D ".
    pub code: String,
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

fn validate_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name cannot be empty".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') || name.contains('\0') {
        return Err("name cannot contain path separators".into());
    }
    Ok(name.to_string())
}

fn list_dir_blocking(path: &str) -> Result<Vec<DirEntry>, String> {
    let dir = PathBuf::from(path);
    let mut entries: Vec<DirEntry> = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| format!("cannot read {path}: {e}"))?;
    for entry in rd.flatten() {
        // Skip individual bad entries (broken junctions, permissions) instead
        // of failing the whole listing.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
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

fn write_file_blocking(path: &str, content: &str) -> Result<(), String> {
    if is_read_only(path) {
        return Err(format!(
            "{path} is protected by Relay's read-only patterns (Complete Docs §8.4)"
        ));
    }
    let target = PathBuf::from(path);

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
pub async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_dir_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!(
                "file too large ({} bytes; cap is {MAX_FILE_BYTES})",
                meta.len()
            ));
        }
        fs::read_to_string(&path).map_err(|e| format!("cannot read {path}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_file_blocking(&path, &content))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_file(parent: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = validate_name(&name)?;
        let path = PathBuf::from(&parent).join(&name);
        let path_str = path.display().to_string();
        if is_read_only(&path_str) {
            return Err(format!(
                "{path_str} is protected by Relay's read-only patterns"
            ));
        }
        if path.exists() {
            return Err(format!("{name} already exists"));
        }
        fs::write(&path, "").map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_dir(parent: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = validate_name(&name)?;
        let path = PathBuf::from(&parent).join(&name);
        if path.exists() {
            return Err(format!("{name} already exists"));
        }
        fs::create_dir(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_path(path: String, new_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let new_name = validate_name(&new_name)?;
        if is_read_only(&path) {
            return Err(format!(
                "{path} is protected by Relay's read-only patterns"
            ));
        }
        let target = PathBuf::from(&path);
        let parent = target.parent().ok_or("path has no parent")?;
        let dest = parent.join(&new_name);
        if dest.exists() {
            return Err(format!("{new_name} already exists"));
        }
        fs::rename(&target, &dest).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if is_read_only(&path) {
            return Err(format!(
                "{path} is protected by Relay's read-only patterns"
            ));
        }
        let target = PathBuf::from(&path);
        if !target.exists() {
            return Err("path does not exist".into());
        }
        if target.is_dir() {
            fs::remove_dir_all(&target).map_err(|e| e.to_string())
        } else {
            fs::remove_file(&target).map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// F3 — git status badges for the file tree (docs §3.1: M/A/U/D/C).
/// Returns repo-relative paths with porcelain codes; not a git repo → empty.
#[tauri::command]
pub async fn git_status(root: String) -> Result<Vec<GitStatusEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = std::process::Command::new("git")
            .args(["-C", &root, "status", "--porcelain", "-z"])
            .output();
        let out = match out {
            Ok(o) if o.status.success() => o,
            _ => return Ok(vec![]), // git missing or not a repo: no badges
        };
        let mut entries = Vec::new();
        for chunk in out.stdout.split(|b| *b == 0) {
            // Record format: "XY <path>"; rename records add a second
            // NUL-separated path field that has no "XY " prefix — skip it.
            if chunk.len() < 4 || chunk[2] != b' ' {
                continue;
            }
            let code = String::from_utf8_lossy(&chunk[..2]).to_string();
            let path = String::from_utf8_lossy(&chunk[3..]).to_string();
            entries.push(GitStatusEntry { path, code });
        }
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compact project tree text for AI context (Complete Docs §3.4 / §10.2D).
/// Skips the standard exclude dirs and caps the walk so huge repos don't
/// flood the context window.
fn tree_summary_blocking(
    root: &str,
    max_depth: usize,
    depth: usize,
    count: &mut usize,
    max_nodes: usize,
) -> Result<String, String> {
    let mut out = String::new();
    if depth > max_depth || *count >= max_nodes {
        return Ok(out);
    }
    let entries = list_dir_blocking(root)?;
    for e in entries {
        if *count >= max_nodes {
            out.push_str(&format!("{}… (truncated)\n", "  ".repeat(depth + 1)));
            break;
        }
        *count += 1;
        out.push_str(&format!(
            "{}{}{}\n",
            "  ".repeat(depth + 1),
            if e.is_dir { "📁 " } else { "   " },
            e.name
        ));
        if e.is_dir {
            out.push_str(&tree_summary_blocking(&e.path, max_depth, depth + 1, count, max_nodes)?);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn tree_summary(root: String, max_depth: usize) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut count = 0usize;
        let mut out = format!("📂 {root}\n");
        out.push_str(&tree_summary_blocking(
            &root,
            max_depth.min(6),
            0,
            &mut count,
            300,
        )?);
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pick_project_dir() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select your project folder")
            .pick_folder()
            .map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

/// Recursive case-insensitive grep over the project tree (UI feature #4).
/// Skips the standard exclude dirs, caps file size and result count so huge
/// repos stay responsive, and only matches UTF-8 text files.
fn search_blocking(
    root: &Path,
    query: &str,
    max_results: usize,
    out: &mut Vec<SearchHit>,
) -> Result<(), String> {
    if out.len() >= max_results {
        return Ok(());
    }
    let entries = list_dir_blocking(&root.display().to_string())?;
    for e in entries {
        if out.len() >= max_results {
            return Ok(());
        }
        if e.is_dir {
            if EXCLUDE_DIRS.contains(&e.name.as_str()) {
                continue;
            }
            search_blocking(Path::new(&e.path), query, max_results, out)?;
            continue;
        }
        // Skip oversized and clearly non-text files.
        let Ok(meta) = fs::metadata(&e.path) else { continue };
        if meta.len() > 1024 * 1024 {
            continue;
        }
        let Ok(content) = fs::read_to_string(&e.path) else { continue };
        let lower = query.to_lowercase();
        for (i, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&lower) {
                out.push(SearchHit {
                    path: e.path.clone(),
                    line: i + 1,
                    text: line.trim().chars().take(200).collect(),
                });
                if out.len() >= max_results {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn search_files(
    root: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        search_blocking(
            Path::new(&root),
            &query,
            max_results.unwrap_or(200).min(500),
            &mut out,
        )?;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Current git branch of a project (UI feature #8), "" when not a repo.
#[tauri::command]
pub fn git_branch(root: String) -> Result<String, String> {
    if root.is_empty() {
        return Ok(String::new());
    }
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&root)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
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
