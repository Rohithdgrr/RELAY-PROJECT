//! F4 — embedded PTY terminal.
//!
//! v0.1: portable-pty (Rust, no Node sidecar) + xterm.js on the frontend.
//! Output streams to the UI via `terminal://output` events and is retained in
//! a scrollback buffer so the Relay Engine can capture terminal state for
//! Relay Packets (Complete Docs §7.2C).
//!
//! Windows note: the master `PtyPair` MUST stay alive for the life of the
//! session — it owns the ConPTY `PseudoConsole` handle, and dropping it calls
//! `ClosePseudoConsole`, which terminates the attached shell. We store the
//! master in the session and keep it until `kill_terminal`.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::types::TerminalState;

pub struct TerminalSession {
    pub id: u32,
    pub cwd: String,
    /// Kept alive for the session — see module docs (ConPTY ownership).
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Last ~64KB of output, for Relay Packet capture.
    buffer: Arc<Mutex<String>>,
}

pub struct TerminalManager {
    sessions: Mutex<HashMap<u32, TerminalSession>>,
    next_id: Mutex<u32>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        TerminalManager {
            sessions: Mutex::new(HashMap::new()),
            next_id: Mutex::new(0),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct TerminalOutput {
    pub id: u32,
    pub data: String,
}

#[derive(Serialize, Clone)]
pub struct TerminalExit {
    pub id: u32,
}

/// Pick the user's real shell: `$SHELL` if set, else Git Bash on Windows
/// (the app is often launched outside a bash environment, so `$SHELL` is
/// unset), else the platform default.
fn default_shell() -> String {
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.trim().is_empty() {
            return shell;
        }
    }
    if cfg!(windows) {
        const CANDIDATES: &[&str] = &[
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            r#"%LOCALAPPDATA%\Programs\Git\bin\bash.exe"#,
        ];
        for c in CANDIDATES {
            let expanded = c.replace("%LOCALAPPDATA%", &std::env::var("LOCALAPPDATA").unwrap_or_default());
            if Path::new(&expanded).exists() {
                return expanded;
            }
        }
        "cmd".to_string()
    } else {
        "bash".to_string()
    }
}

#[tauri::command]
pub fn spawn_terminal(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = default_shell();
    let mut cmd = CommandBuilder::new(shell);
    if let Some(dir) = &cwd {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let mut next = state.next_id.lock().unwrap();
    *next += 1;
    let id = *next;

    // Banner: confirms the shell is live and sets the "confirm by default"
    // expectation (Complete Docs §8.4).
    let _ = writer.write_all(
        b"\x1b[38;5;105mRelay v0.1 - PTY ready. Destructive commands require confirmation.\x1b[0m\r\n",
    );
    let _ = writer.flush();

    let buffer: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    state.sessions.lock().unwrap().insert(
        id,
        TerminalSession {
            id,
            cwd: cwd.unwrap_or_default(),
            master: pair.master, // keep the ConPTY / pty alive
            writer,
            child,
            buffer: buffer.clone(),
        },
    );

    // Reader thread: stream to the frontend + keep the capture buffer.
    // When the stream ends (shell exit), notify the UI so it can offer a
    // restart instead of showing a silently dead terminal.
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit(
                        "terminal://output",
                        TerminalOutput {
                            id,
                            data: data.clone(),
                        },
                    );
                    let mut scrollback = buffer.lock().unwrap();
                    scrollback.push_str(&data);
                    const CAP: usize = 65_536;
                    if scrollback.len() > CAP {
                        let excess = scrollback.len() - CAP;
                        scrollback.drain(..excess);
                    }
                }
            }
        }
        let _ = app2.emit("terminal://exit", TerminalExit { id });
    });

    Ok(id)
}

#[tauri::command]
pub fn write_stdin(state: State<'_, TerminalManager>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("terminal not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// F4/AI bridge — execute a command in the active terminal (surfaced from AI
/// code blocks as user-confirmed [▶ Run] actions). Nothing runs without the
/// user clicking Run.
#[tauri::command]
pub fn run_command(state: State<'_, TerminalManager>, command: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .values_mut()
        .next()
        .ok_or("no terminal session — restart the terminal first")?;
    session
        .writer
        .write_all(command.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.write_all(b"\r").map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Keep the PTY in sync with the xterm.js viewport so line wrapping and full
/// screen apps (vim, top) behave correctly.
#[tauri::command]
pub fn resize_terminal(
    state: State<'_, TerminalManager>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("terminal not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kill_terminal(state: State<'_, TerminalManager>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

impl TerminalManager {
    /// Capture terminal state for a Relay Packet (Complete Docs §7.2C).
    /// v0.1: cwd + last output; command logging arrives with shell
    /// integration in a later phase.
    pub fn snapshot(&self) -> TerminalState {
        let sessions = self.sessions.lock().unwrap();
        let Some(session) = sessions.values().next() else {
            return TerminalState {
                last_commands: vec![],
                current_directory: String::new(),
                recent_output: String::new(),
            };
        };
        let scrollback = session.buffer.lock().unwrap();
        let tail: String = scrollback
            .chars()
            .rev()
            .take(4000)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        TerminalState {
            last_commands: vec![],
            current_directory: session.cwd.clone(),
            recent_output: tail,
        }
    }
}
